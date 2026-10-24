import { errors } from "@polar-sh/sdk/2026-10";

import { FunnelEvent } from "@/lib/analytics/events";
import { captureServerEvent } from "@/lib/analytics/server";
import { appUrl } from "@/lib/app-url";
import { auth } from "@/lib/auth/server";
import { userHasPaidPlan } from "@/lib/billing/entitlement";
import { BillingNotConfiguredError, billingServer, getPolar, type PolarClient } from "@/lib/billing/polar";
import { isConfiguredProductId, planForProduct } from "@/lib/billing/products";

export type BillingRouteDeps = {
  session: () => Promise<{ id: string; email?: string | null } | null>;
  polar: () => PolarClient;
  isPaid: (userId: string) => Promise<boolean>;
  origin: () => string;
  /** Funnel analytics; defaults to PostHog. Never affects the redirect. */
  track?: (userId: string, plan: string) => Promise<void>;
};

const trackCheckout = (userId: string, plan: string) =>
  captureServerEvent(FunnelEvent.CheckoutStarted, userId, { plan });

const defaultDeps: BillingRouteDeps = {
  session: async () => {
    const { data } = await auth.getSession();
    const user = data?.user;
    return user?.id ? { id: String(user.id), email: user.email } : null;
  },
  polar: () => getPolar(),
  isPaid: userHasPaidPlan,
  origin: appUrl,
};

/** 303 so a POSTed form lands on a GET of the target. */
function redirectTo(url: string): Response {
  return new Response(null, { status: 303, headers: { Location: url } });
}

function pricingWith(origin: string, error: string): Response {
  return redirectTo(`${origin}/pricing?error=${encodeURIComponent(error)}`);
}

/**
 * POST /api/billing/checkout (form field `productId`). Creates a Polar checkout for the signed-in
 * user and redirects to it. The user id comes from the server session, never from the request,
 * and only product ids listed in lib/billing/products.ts for this server are accepted.
 */
export async function createCheckout(request: Request, deps: BillingRouteDeps = defaultDeps): Promise<Response> {
  const origin = deps.origin();
  const user = await deps.session();
  if (!user) return redirectTo(`${origin}/auth/sign-in`);

  const form = await request.formData().catch(() => null);
  const productId = String(form?.get("productId") ?? "").trim();
  const plan = productId ? planForProduct(productId, billingServer()) : undefined;
  if (!plan) return pricingWith(origin, "unknown-product");
  if (!isConfiguredProductId(productId)) return pricingWith(origin, "not-configured");

  try {
    // One live subscription per user: send existing subscribers to manage it instead.
    if (await deps.isPaid(user.id)) return redirectTo(`${origin}/api/billing/portal`);
    const checkout = await deps.polar().checkouts.create({
      products: [productId],
      external_customer_id: user.id,
      ...(user.email ? { customer_email: user.email } : {}),
      success_url: `${origin}/success?checkout_id={CHECKOUT_ID}`,
      return_url: `${origin}/pricing`,
    });
    await (deps.track ?? trackCheckout)(user.id, plan.key);
    return redirectTo(checkout.url);
  } catch (error) {
    if (error instanceof BillingNotConfiguredError) return pricingWith(origin, "not-configured");
    console.error("[billing/checkout] failed", { error: error instanceof Error ? error.name : "unknown" });
    return pricingWith(origin, "checkout-failed");
  }
}

/** GET /api/billing/portal. Redirects the signed-in user to their Polar customer portal. */
export async function openCustomerPortal(_request: Request, deps: BillingRouteDeps = defaultDeps): Promise<Response> {
  const origin = deps.origin();
  const user = await deps.session();
  if (!user) return redirectTo(`${origin}/auth/sign-in`);
  try {
    const session = await deps.polar().customerSessions.create({
      external_customer_id: user.id,
      return_url: `${origin}/settings/plan`,
    });
    return redirectTo(session.customer_portal_url);
  } catch (error) {
    if (error instanceof BillingNotConfiguredError) return pricingWith(origin, "not-configured");
    // No Polar customer yet means nothing has been bought: offer the plans instead.
    if (error instanceof errors.ResourceNotFound) return pricingWith(origin, "no-subscription");
    console.error("[billing/portal] failed", { error: error instanceof Error ? error.name : "unknown" });
    return pricingWith(origin, "portal-failed");
  }
}
