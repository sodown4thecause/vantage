import { errors } from "@polar-sh/sdk/2026-10";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { PRO_MONTHLY } = vi.hoisted(() => ({ PRO_MONTHLY: "11111111-1111-4111-8111-111111111111" }));

vi.mock("@/lib/auth/server", () => ({ auth: { getSession: async () => ({ data: null }) } }));
vi.mock("@/lib/billing/products", async (original) => {
  const actual = await original<typeof import("@/lib/billing/products")>();
  const plans = [
    { ...actual.BILLING_PLANS[0], productIds: { sandbox: PRO_MONTHLY, production: PRO_MONTHLY } },
    actual.BILLING_PLANS[1], // still holding its placeholder ids
  ];
  return { ...actual, BILLING_PLANS: plans,
    planForProduct: (id: string, server: "sandbox" | "production") => plans.find(p => p.productIds[server] === id) };
});

import { effectivePlanSql, userIsPaidSql } from "@/lib/billing/entitlement";
import { billingServer, BillingNotConfiguredError, getPolar } from "@/lib/billing/polar";
import { BILLING_PLANS, isConfiguredProductId } from "@/lib/billing/products";
import { createCheckout, openCustomerPortal, type BillingRouteDeps } from "@/lib/billing/routes";

const ORIGIN = "https://www.contextfor.dev";
const create = vi.fn();
const portal = vi.fn();
const deps = (overrides: Partial<BillingRouteDeps> = {}): BillingRouteDeps => ({
  session: async () => ({ id: "user_1", email: "founder@example.com" }),
  polar: () => ({ checkouts: { create }, customerSessions: { create: portal } }) as never,
  isPaid: async () => false,
  origin: () => ORIGIN,
  ...overrides,
});

const post = (fields: Record<string, string>) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return new Request(`${ORIGIN}/api/billing/checkout`, { method: "POST", body: form });
};
const location = (res: Response) => res.headers.get("location");

beforeEach(() => {
  create.mockReset(); portal.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("checkout route", () => {
  it("sends signed-out visitors to sign in without calling Polar", async () => {
    const res = await createCheckout(post({ productId: PRO_MONTHLY }), deps({ session: async () => null }));
    expect(res.status).toBe(303);
    expect(location(res)).toBe(`${ORIGIN}/auth/sign-in`);
    expect(create).not.toHaveBeenCalled();
  });

  it("creates a checkout for the session user, never a user id from the request", async () => {
    create.mockResolvedValue({ url: "https://sandbox.polar.sh/checkout/abc" });
    const res = await createCheckout(post({ productId: PRO_MONTHLY, external_customer_id: "someone_else" }), deps());
    expect(res.status).toBe(303);
    expect(location(res)).toBe("https://sandbox.polar.sh/checkout/abc");
    expect(create).toHaveBeenCalledWith({
      products: [PRO_MONTHLY],
      external_customer_id: "user_1",
      customer_email: "founder@example.com",
      success_url: `${ORIGIN}/success?checkout_id={CHECKOUT_ID}`,
      return_url: `${ORIGIN}/pricing`,
    });
  });

  it("records checkout_started by user id and plan once the checkout exists", async () => {
    create.mockResolvedValue({ url: "https://sandbox.polar.sh/checkout/abc" });
    const track = vi.fn(async () => {});
    await createCheckout(post({ productId: PRO_MONTHLY }), deps({ track }));
    expect(track).toHaveBeenCalledWith("user_1", "pro_monthly");

    track.mockClear();
    create.mockRejectedValue(new Error("polar down"));
    await createCheckout(post({ productId: PRO_MONTHLY }), deps({ track }));
    expect(track).not.toHaveBeenCalled();
  });

  it("only sells products listed in the config", async () => {
    const res = await createCheckout(post({ productId: "33333333-3333-4333-8333-333333333333" }), deps());
    expect(location(res)).toBe(`${ORIGIN}/pricing?error=unknown-product`);
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses placeholder product ids with a not-configured message", async () => {
    const res = await createCheckout(post({ productId: BILLING_PLANS[1].productIds.sandbox }), deps());
    expect(location(res)).toBe(`${ORIGIN}/pricing?error=not-configured`);
    expect(create).not.toHaveBeenCalled();
  });

  it("sends an existing subscriber to the portal instead of a second subscription", async () => {
    const res = await createCheckout(post({ productId: PRO_MONTHLY }), deps({ isPaid: async () => true }));
    expect(location(res)).toBe(`${ORIGIN}/api/billing/portal`);
    expect(create).not.toHaveBeenCalled();
  });

  it("reports missing credentials and Polar failures without leaking detail", async () => {
    let res = await createCheckout(post({ productId: PRO_MONTHLY }), deps({ polar: () => { throw new BillingNotConfiguredError(); } }));
    expect(location(res)).toBe(`${ORIGIN}/pricing?error=not-configured`);
    create.mockRejectedValue(new Error("upstream 500 with secret details"));
    res = await createCheckout(post({ productId: PRO_MONTHLY }), deps());
    expect(location(res)).toBe(`${ORIGIN}/pricing?error=checkout-failed`);
  });
});

describe("customer portal route", () => {
  it("requires a signed-in user", async () => {
    const res = await openCustomerPortal(new Request(`${ORIGIN}/api/billing/portal`), deps({ session: async () => null }));
    expect(location(res)).toBe(`${ORIGIN}/auth/sign-in`);
    expect(portal).not.toHaveBeenCalled();
  });

  it("opens the portal for the session user", async () => {
    portal.mockResolvedValue({ customer_portal_url: "https://sandbox.polar.sh/portal/xyz" });
    const res = await openCustomerPortal(new Request(`${ORIGIN}/api/billing/portal`), deps());
    expect(location(res)).toBe("https://sandbox.polar.sh/portal/xyz");
    expect(portal).toHaveBeenCalledWith({ external_customer_id: "user_1", return_url: `${ORIGIN}/settings/plan` });
  });

  it("sends users with no Polar customer to pricing", async () => {
    portal.mockRejectedValue(new errors.ResourceNotFound(404, { error: "ResourceNotFound", detail: "Not found" } as never));
    const res = await openCustomerPortal(new Request(`${ORIGIN}/api/billing/portal`), deps());
    expect(location(res)).toBe(`${ORIGIN}/pricing?error=no-subscription`);
  });
});

describe("billing config and entitlement", () => {
  it("defaults to the sandbox unless POLAR_SERVER is exactly production", () => {
    expect(billingServer({})).toBe("sandbox");
    expect(billingServer({ POLAR_SERVER: "live" })).toBe("sandbox");
    expect(billingServer({ POLAR_SERVER: "production" })).toBe("production");
  });

  it("needs an access token before building a client", () => {
    expect(() => getPolar({})).toThrow(BillingNotConfiguredError);
  });

  it("treats only UUIDs as configured product ids", () => {
    expect(isConfiguredProductId(PRO_MONTHLY)).toBe(true);
    expect(isConfiguredProductId("REPLACE_WITH_SANDBOX_PRO_MONTHLY_PRODUCT_ID")).toBe(false);
  });

  it("grants Pro only for a live, unended pro subscription of that user", () => {
    const { sql: text, params } = new PgDialect().sqlToQuery(userIsPaidSql(sql`${"user_1"}`));
    expect(params).toEqual(["user_1"]);
    expect(text).toContain(`"bs"."user_id" = $1`);
    expect(text).toContain(`"bs"."plan" = 'pro'`);
    expect(text).toContain(`"bs"."status" in ('active', 'trialing', 'past_due')`);
    expect(text).toContain(`"bs"."ended_at" is null or "bs"."ended_at" > now()`);
  });

  it("derives a workspace's plan from its owner's subscription or an operator grant", () => {
    const { sql: text, params } = new PgDialect().sqlToQuery(effectivePlanSql("ws-1"));
    expect(params).toEqual(["ws-1"]);
    expect(text).toContain(`"w"."plan" = 'pro' or exists`);
    expect(text).toContain(`"bs"."user_id" = "w"."owner_user_id"`);
    expect(text).toContain(`"w"."id" = $1::uuid`);
  });
});
