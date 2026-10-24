import { createHmac, randomBytes } from "node:crypto";
import { errors } from "@polar-sh/sdk/2026-10";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { PRO_MONTHLY } = vi.hoisted(() => ({ PRO_MONTHLY: "11111111-1111-4111-8111-111111111111" }));

const db = vi.hoisted(() => ({
  /** "claimed" | "processed" | "busy": how the claim upsert resolves. */
  claim: "claimed" as "claimed" | "processed" | "busy",
  inserts: [] as Array<{ table: string; values: Record<string, unknown>; conflict?: Record<string, unknown> }>,
  updates: [] as Array<{ table: string; set: Record<string, unknown> }>,
  deletes: [] as string[],
}));

const tableName = (table: unknown) => (table as { [k: symbol]: string })[Symbol.for("drizzle:Name")];

vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        const record = { table: tableName(table), values } as (typeof db.inserts)[number];
        db.inserts.push(record);
        return {
          onConflictDoUpdate: (conflict: Record<string, unknown>) => {
            record.conflict = conflict;
            const done = Promise.resolve(undefined);
            return Object.assign(done, {
              returning: async () => (db.claim === "claimed" ? [{ id: values.id }] : []),
            });
          },
          onConflictDoNothing: async () => undefined,
        };
      },
    }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ processedAt: db.claim === "processed" ? new Date() : null }] }) }) }),
    update: (table: unknown) => ({ set: (set: Record<string, unknown>) => ({ where: async () => { db.updates.push({ table: tableName(table), set }); } }) }),
    delete: (table: unknown) => ({ where: () => { db.deletes.push(tableName(table)); return Promise.resolve(); } }),
  }),
}));

vi.mock("@/lib/billing/products", async (original) => {
  const actual = await original<typeof import("@/lib/billing/products")>();
  const plans = [{ ...actual.BILLING_PLANS[0], productIds: { sandbox: PRO_MONTHLY, production: PRO_MONTHLY } }];
  return { ...actual, BILLING_PLANS: plans,
    planForProduct: (id: string, server: "sandbox" | "production") => plans.find(p => p.productIds[server] === id) };
});

import { handlePolarWebhook, type WebhookDeps } from "@/lib/billing/webhook";

const key = randomBytes(24);
const secret = `whsec_${key.toString("base64")}`;
let seq = 0;

function delivery(type: string, data: Record<string, unknown>, opts: { id?: string; signWith?: Buffer } = {}) {
  const id = opts.id ?? `msg_${++seq}`;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({ type, timestamp: new Date().toISOString(), data });
  const signature = createHmac("sha256", opts.signWith ?? key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return new Request("https://contextfor.dev/api/webhooks/polar", { method: "POST", body,
    headers: { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": timestamp, "webhook-signature": `v1,${signature}` } });
}

const subscription = (overrides: Record<string, unknown> = {}) => ({
  id: "sub_1", status: "active", product_id: PRO_MONTHLY, customer_id: "cus_1", cancel_at_period_end: false,
  current_period_end: "2026-11-13T00:00:00Z", ended_at: null, modified_at: "2026-10-13T00:00:00Z",
  customer: { external_id: "user_1" }, ...overrides,
});

const get = vi.fn();
const deps = (overrides: Partial<WebhookDeps> = {}): WebhookDeps => ({
  secret: () => secret,
  polar: () => ({ subscriptions: { get } }) as never,
  ...overrides,
});

const subscriptionWrites = () => db.inserts.filter(i => i.table === "billing_subscription");

beforeEach(() => {
  db.claim = "claimed"; db.inserts = []; db.updates = []; db.deletes = [];
  get.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("Polar webhook endpoint", () => {
  it("refuses to run without a webhook secret", async () => {
    const res = await handlePolarWebhook(delivery("subscription.updated", subscription()), deps({ secret: () => undefined }));
    expect(res.status).toBe(503);
    expect(db.inserts).toEqual([]);
  });

  it("rejects a bad signature before touching the database", async () => {
    const res = await handlePolarWebhook(delivery("subscription.updated", subscription(), { signWith: randomBytes(24) }), deps());
    expect(res.status).toBe(403);
    expect(db.inserts).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });

  it("acknowledges signed events it does not handle without writing", async () => {
    const res = await handlePolarWebhook(delivery("customer.created", { id: "cus_1" }), deps());
    expect(res.status).toBe(202);
    expect(db.inserts).toEqual([]);
  });

  it.each(["subscription.created", "subscription.updated", "subscription.active", "subscription.canceled", "subscription.revoked"])(
    "%s re-fetches the canonical subscription and stores it for the external customer",
    async (type) => {
      get.mockResolvedValue(subscription({ status: type === "subscription.revoked" ? "canceled" : "active",
        ended_at: type === "subscription.revoked" ? "2026-10-13T00:00:00Z" : null }));
      // The delivered payload is deliberately stale; only the re-fetched copy may be stored.
      const res = await handlePolarWebhook(delivery(type, subscription({ status: "incomplete" })), deps());
      expect(res.status).toBe(202);
      expect(get).toHaveBeenCalledWith("sub_1");
      const [write] = subscriptionWrites();
      expect(write.values).toMatchObject({ id: "sub_1", userId: "user_1", polarCustomerId: "cus_1", productId: PRO_MONTHLY, plan: "pro" });
      expect(write.values.status).toBe(type === "subscription.revoked" ? "canceled" : "active");
      if (type === "subscription.revoked") expect(write.values.endedAt).toEqual(new Date("2026-10-13T00:00:00Z"));
      expect(db.updates).toEqual([expect.objectContaining({ table: "billing_webhook_event", set: { processedAt: expect.any(Date) } })]);
    },
  );

  it("never grants a plan for a product that is not in the config", async () => {
    get.mockResolvedValue(subscription({ product_id: "22222222-2222-4222-8222-222222222222" }));
    await handlePolarWebhook(delivery("subscription.active", subscription()), deps());
    expect(subscriptionWrites()[0].values.plan).toBeNull();
  });

  it("guards against moving a subscription backwards in time", async () => {
    get.mockResolvedValue(subscription());
    await handlePolarWebhook(delivery("subscription.updated", subscription()), deps());
    expect(subscriptionWrites()[0].conflict).toHaveProperty("setWhere");
  });

  it("ignores subscriptions bought outside our checkout (no external customer id)", async () => {
    get.mockResolvedValue(subscription({ customer: { external_id: null } }));
    const res = await handlePolarWebhook(delivery("subscription.active", subscription()), deps());
    expect(res.status).toBe(202);
    expect(subscriptionWrites()).toEqual([]);
  });

  it("falls back to the delivered payload when Polar no longer has the subscription", async () => {
    get.mockRejectedValue(new errors.ResourceNotFound(404, { error: "ResourceNotFound", detail: "Not found" } as never));
    await handlePolarWebhook(delivery("subscription.revoked", subscription({ status: "canceled" })), deps());
    expect(subscriptionWrites()[0].values.status).toBe("canceled");
  });

  it("processes a replayed webhook-id once", async () => {
    db.claim = "processed";
    const res = await handlePolarWebhook(delivery("subscription.updated", subscription(), { id: "msg_dup" }), deps());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ duplicate: true });
    expect(get).not.toHaveBeenCalled();
  });

  it("asks Polar to retry while another run holds the claim", async () => {
    db.claim = "busy";
    const res = await handlePolarWebhook(delivery("subscription.updated", subscription()), deps());
    expect(res.status).toBe(409);
    expect(get).not.toHaveBeenCalled();
  });

  it("releases the claim and returns 500 when processing fails, so the retry runs again", async () => {
    get.mockRejectedValue(new Error("network down"));
    const res = await handlePolarWebhook(delivery("subscription.updated", subscription()), deps());
    expect(res.status).toBe(500);
    expect(db.deletes).toEqual(["billing_webhook_event"]);
    expect(db.updates).toEqual([]);
  });

  it("order.paid records the order and syncs its subscription", async () => {
    get.mockResolvedValue(subscription());
    const res = await handlePolarWebhook(delivery("order.paid", { id: "ord_1", status: "paid", product_id: PRO_MONTHLY,
      subscription_id: "sub_1", customer_id: "cus_1", total_amount: 500, currency: "usd", customer: { external_id: "user_1" } }), deps());
    expect(res.status).toBe(202);
    expect(db.inserts.find(i => i.table === "billing_order")?.values).toMatchObject({ id: "ord_1", userId: "user_1", totalAmount: 500, currency: "usd" });
    expect(get).toHaveBeenCalledWith("sub_1");
    expect(subscriptionWrites()).toHaveLength(1);
  });

  it("checkout.updated is acknowledged and recorded without changing entitlements", async () => {
    const res = await handlePolarWebhook(delivery("checkout.updated", { id: "chk_1", status: "succeeded" }), deps());
    expect(res.status).toBe(202);
    expect(subscriptionWrites()).toEqual([]);
    expect(db.inserts.map(i => i.table)).toEqual(["billing_webhook_event"]);
  });

  it("records subscribed once, for subscription.active only, after the delivery is processed", async () => {
    const trackSubscribed = vi.fn(async () => {});
    get.mockResolvedValue(subscription());
    await handlePolarWebhook(delivery("subscription.active", subscription()), deps({ trackSubscribed }));
    expect(trackSubscribed).toHaveBeenCalledWith("user_1", PRO_MONTHLY);

    trackSubscribed.mockClear();
    await handlePolarWebhook(delivery("subscription.updated", subscription()), deps({ trackSubscribed }));
    db.claim = "processed";
    await handlePolarWebhook(delivery("subscription.active", subscription(), { id: "msg_dup" }), deps({ trackSubscribed }));
    expect(trackSubscribed).not.toHaveBeenCalled();
  });

  it("does not record subscribed when processing fails or there is no external customer", async () => {
    const trackSubscribed = vi.fn(async () => {});
    get.mockRejectedValue(new Error("polar down"));
    await handlePolarWebhook(delivery("subscription.active", subscription()), deps({ trackSubscribed }));
    get.mockResolvedValue(subscription({ customer: { external_id: null } }));
    await handlePolarWebhook(delivery("subscription.active", subscription({ customer: { external_id: null } })), deps({ trackSubscribed }));
    expect(trackSubscribed).not.toHaveBeenCalled();
  });
});
