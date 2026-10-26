import type { PlanId } from "@/lib/plans/types";

/**
 * Polar products sold on /pricing. Product ids differ between the sandbox and production
 * organizations, so each plan lists both.
 *
 * REPLACE the placeholder ids with the product ids from the Polar dashboard
 * (Products → ⋯ → Copy product id). Until then checkout refuses the plan with
 * "not configured" instead of calling Polar. Prices shown here are labels only; Polar
 * charges what the product's price says.
 */
export type BillingServer = "sandbox" | "production";

export type BillingPlan = {
  key: "pro_monthly" | "pro_yearly";
  name: string;
  priceLabel: string;
  interval: "month" | "year";
  /** Plan the subscription grants while it is live. */
  grants: Exclude<PlanId, "free">;
  productIds: Record<BillingServer, string>;
};

export const BILLING_PLANS: readonly BillingPlan[] = [
  {
    key: "pro_monthly",
    name: "Pro monthly",
    priceLabel: "$19",
    interval: "month",
    grants: "pro",
    productIds: {
      sandbox: "REPLACE_WITH_SANDBOX_PRO_MONTHLY_PRODUCT_ID",
      production: "0e072813-4013-4995-8ae8-917320151539",
    },
  },
  {
    key: "pro_yearly",
    name: "Pro yearly",
    priceLabel: "$48",
    interval: "year",
    grants: "pro",
    productIds: {
      sandbox: "REPLACE_WITH_SANDBOX_PRO_YEARLY_PRODUCT_ID",
      production: "9046f05b-e8da-4a30-862e-d886308cda2c",
    },
  },
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Polar product ids are UUIDs; anything else is an unfilled placeholder. */
export function isConfiguredProductId(productId: string): boolean {
  return UUID_RE.test(productId);
}

/** The configured plan for a product id on this server, or undefined (never trusts other ids). */
export function planForProduct(productId: string, server: BillingServer): BillingPlan | undefined {
  return BILLING_PLANS.find(plan => plan.productIds[server] === productId);
}
