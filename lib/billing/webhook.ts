import { errors, webhooks } from "@polar-sh/sdk/2026-10";
import { and, eq, isNull, lt, sql } from "drizzle-orm";

import { billingServer, getPolar, type PolarClient } from "@/lib/billing/polar";
import { captureProductEvent } from "@/lib/analytics/server";
import { withObservedSpan } from "@/lib/analytics/spans.mjs";
import { recordPaidOrder, syncSubscription, type PolarSubscriptionLike } from "@/lib/billing/sync";
import { getDb } from "@/lib/db/client";
import { billingWebhookEvent, workspace } from "@/lib/db/schema";

/** Events this endpoint acts on. Anything else is acknowledged and ignored. */
export const HANDLED_EVENTS = [
  "checkout.updated",
  "order.paid",
  "subscription.created",
  "subscription.updated",
  "subscription.active",
  "subscription.canceled",
  "subscription.revoked",
] as const;
type HandledEvent = (typeof HANDLED_EVENTS)[number];

/** A claim older than this is treated as abandoned (the Worker died mid-run) and can be retaken. */
const CLAIM_TIMEOUT_SECONDS = 120;

export type WebhookDeps = {
  polar: () => PolarClient;
  secret: () => string | undefined;
  workspaceIdForUser?: (userId: string) => Promise<string | undefined>;
};

const defaultDeps: WebhookDeps = {
  polar: () => getPolar(),
  secret: () => process.env.POLAR_WEBHOOK_SECRET?.trim(),
  workspaceIdForUser: async (userId) => {
    const [row] = await getDb().select({ id: workspace.id }).from(workspace)
      .where(eq(workspace.ownerUserId, userId)).limit(1);
    return row?.id;
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isHandled(type: string): type is HandledEvent {
  return (HANDLED_EVENTS as readonly string[]).includes(type);
}

/**
 * Takes this delivery's `webhook-id`. Returns "claimed" when this run should process it,
 * "processed" when an earlier delivery already did, and "busy" while another run holds a fresh claim.
 */
async function claim(id: string, type: string): Promise<"claimed" | "processed" | "busy"> {
  const db = getDb();
  const taken = await db.insert(billingWebhookEvent).values({ id, type })
    .onConflictDoUpdate({
      target: billingWebhookEvent.id,
      set: { receivedAt: sql`now()` },
      setWhere: and(isNull(billingWebhookEvent.processedAt),
        lt(billingWebhookEvent.receivedAt, sql`now() - make_interval(secs => ${CLAIM_TIMEOUT_SECONDS})`)),
    })
    .returning({ id: billingWebhookEvent.id });
  if (taken.length) return "claimed";
  const [row] = await db.select({ processedAt: billingWebhookEvent.processedAt }).from(billingWebhookEvent)
    .where(eq(billingWebhookEvent.id, id)).limit(1);
  return row?.processedAt ? "processed" : "busy";
}

/**
 * Re-fetches the canonical subscription so out-of-order or partial deliveries cannot write stale
 * state. A subscription Polar no longer knows falls back to the delivered payload.
 */
async function syncCanonical(polar: PolarClient, id: string, delivered: PolarSubscriptionLike | null): Promise<void> {
  let subscription: PolarSubscriptionLike;
  try {
    subscription = await polar.subscriptions.get(id);
  } catch (error) {
    if (!(error instanceof errors.ResourceNotFound) || !delivered) throw error;
    subscription = delivered;
  }
  await syncSubscription(subscription, billingServer());
}

async function applyEvent(
  type: HandledEvent,
  data: Record<string, unknown>,
  polar: PolarClient,
  workspaceIdForUser?: (userId: string) => Promise<string | undefined>,
): Promise<void> {
  switch (type) {
    case "subscription.created":
    case "subscription.updated":
    case "subscription.active":
    case "subscription.canceled":
    case "subscription.revoked":
      if (typeof data.id !== "string") throw new Error("subscription event without an id");
      await syncCanonical(polar, data.id, data as unknown as PolarSubscriptionLike);
      if (type === "subscription.created") {
        const customer = isRecord(data.customer) ? data.customer : undefined;
        const userId = typeof customer?.external_id === "string" ? customer.external_id.trim() : "";
        if (userId) {
          let workspaceId: string | undefined;
          try { workspaceId = await workspaceIdForUser?.(userId); } catch { /* analytics lookup must not block webhook processing */ }
          await captureProductEvent({ event: "subscribed", userId, ...(workspaceId ? { workspaceId } : {}) });
        }
      }
      return;
    case "order.paid":
      if (typeof data.id !== "string") throw new Error("order event without an id");
      await recordPaidOrder(data as unknown as Parameters<typeof recordPaidOrder>[0]);
      // The first payment is what makes a new subscription live; sync it now rather than wait.
      if (typeof data.subscription_id === "string" && data.subscription_id) {
        await syncCanonical(polar, data.subscription_id, null);
      }
      return;
    case "checkout.updated":
      // Access follows the subscription and order events a successful checkout produces; the
      // checkout itself changes no entitlement. /success reads its status from Polar directly.
      return;
  }
}

/**
 * POST /api/webhooks/polar. Verifies the Standard Webhooks signature with POLAR_WEBHOOK_SECRET,
 * processes each `webhook-id` once, and answers 5xx on failure so Polar retries.
 */
export async function handlePolarWebhook(request: Request, deps: WebhookDeps = defaultDeps): Promise<Response> {
  const secret = deps.secret();
  if (!secret) {
    console.error("[billing/webhook] POLAR_WEBHOOK_SECRET is not configured");
    return Response.json({ error: "not configured" }, { status: 503 });
  }
  const body = await request.text();
  const headers = {
    "webhook-id": request.headers.get("webhook-id") ?? "",
    "webhook-timestamp": request.headers.get("webhook-timestamp") ?? "",
    "webhook-signature": request.headers.get("webhook-signature") ?? "",
  };

  let event: { type: string; data: unknown };
  try {
    event = await webhooks.validateEvent(body, headers, secret);
  } catch (error) {
    // Subclass first: an unknown type is validly signed, so acknowledge it rather than make Polar retry.
    if (error instanceof webhooks.PolarWebhookUnknownTypeError) return new Response(null, { status: 202 });
    if (error instanceof webhooks.PolarWebhookVerificationError) return Response.json({ error: "invalid signature" }, { status: 403 });
    if (error instanceof webhooks.PolarWebhookError) return Response.json({ error: "invalid payload" }, { status: 400 });
    throw error;
  }
  if (!isHandled(event.type)) return new Response(null, { status: 202 });
  const handledEvent = event.type;
  const id = headers["webhook-id"];
  if (!id || typeof event.data !== "object" || event.data === null) {
    return Response.json({ error: "invalid payload" }, { status: 400 });
  }

  const state = await claim(id, event.type);
  if (state === "processed") return Response.json({ duplicate: true }, { status: 200 });
  if (state === "busy") return Response.json({ error: "in progress" }, { status: 409 });

  try {
    await withObservedSpan("billing.polar_webhook", { source: "webhook", provider: "polar" }, async () => {
      await applyEvent(handledEvent, event.data as Record<string, unknown>, deps.polar(), deps.workspaceIdForUser);
      await getDb().update(billingWebhookEvent).set({ processedAt: new Date() }).where(eq(billingWebhookEvent.id, id));
    });
    return new Response(null, { status: 202 });
  } catch (error) {
    // Release the claim so Polar's retry processes the event again. Log the class only.
    await getDb().delete(billingWebhookEvent).where(and(eq(billingWebhookEvent.id, id), isNull(billingWebhookEvent.processedAt)))
      .catch(() => undefined);
    console.error("[billing/webhook] processing failed", { type: event.type, error: error instanceof Error ? error.name : "unknown" });
    return Response.json({ error: "processing failed" }, { status: 500 });
  }
}
