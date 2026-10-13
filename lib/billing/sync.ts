import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { billingOrder, billingSubscription } from "@/lib/db/schema";
import { planForProduct, type BillingServer } from "@/lib/billing/products";

/** The fields we read from a Polar subscription (SDK `Subscription`, API 2026-10). */
export type PolarSubscriptionLike = {
  id: string;
  status: string;
  product_id: string;
  customer_id: string;
  cancel_at_period_end?: boolean | null;
  current_period_end?: Date | string | null;
  ended_at?: Date | string | null;
  modified_at?: Date | string | null;
  created_at?: Date | string | null;
  customer?: { external_id?: string | null } | null;
};

/** The fields we read from a Polar order. */
export type PolarOrderLike = {
  id: string;
  status?: string | null;
  product_id?: string | null;
  subscription_id?: string | null;
  customer_id?: string | null;
  total_amount?: number | null;
  currency?: string | null;
  customer?: { external_id?: string | null } | null;
};

function toDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/**
 * Upserts our copy of a canonical Polar subscription. Returns false (and writes nothing) when
 * the customer has no external id, i.e. the purchase did not start from our checkout.
 * Never moves a row backwards: an older `modified_at` than the stored one is ignored.
 */
export async function syncSubscription(subscription: PolarSubscriptionLike, server: BillingServer): Promise<boolean> {
  const userId = subscription.customer?.external_id?.trim();
  if (!userId) return false;
  const values = {
    id: subscription.id,
    userId,
    polarCustomerId: subscription.customer_id,
    productId: subscription.product_id,
    plan: planForProduct(subscription.product_id, server)?.grants ?? null,
    status: subscription.status,
    cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
    currentPeriodEnd: toDate(subscription.current_period_end),
    endedAt: toDate(subscription.ended_at),
    polarModifiedAt: toDate(subscription.modified_at) ?? toDate(subscription.created_at),
    updatedAt: new Date(),
  };
  await getDb().insert(billingSubscription).values(values).onConflictDoUpdate({
    target: billingSubscription.id,
    set: {
      userId: values.userId, polarCustomerId: values.polarCustomerId, productId: values.productId, plan: values.plan,
      status: values.status, cancelAtPeriodEnd: values.cancelAtPeriodEnd, currentPeriodEnd: values.currentPeriodEnd,
      endedAt: values.endedAt, polarModifiedAt: values.polarModifiedAt, updatedAt: values.updatedAt,
    },
    setWhere: sql`${billingSubscription.polarModifiedAt} is null or excluded."polar_modified_at" is null
      or excluded."polar_modified_at" >= ${billingSubscription.polarModifiedAt}`,
  });
  return true;
}

/** Records a paid order once (orders are immutable once paid; a repeat is a no-op). */
export async function recordPaidOrder(order: PolarOrderLike): Promise<void> {
  await getDb().insert(billingOrder).values({
    id: order.id,
    userId: order.customer?.external_id?.trim() || null,
    polarCustomerId: order.customer_id ?? null,
    productId: order.product_id ?? null,
    subscriptionId: order.subscription_id ?? null,
    status: order.status ?? "paid",
    totalAmount: typeof order.total_amount === "number" ? order.total_amount : null,
    currency: order.currency ?? null,
  }).onConflictDoNothing({ target: billingOrder.id });
}
