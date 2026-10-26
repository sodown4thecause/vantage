import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { gtmPostgresFixture, hasGtmTestDatabase } from "./gtm-postgres-fixture";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db/client", () => ({ getDb: () => state.db }));
import { reserveDiscoveryAttempt, reserveDiscoverySpend, settleDiscoverySpend, withDiscoveryBudget } from "@/lib/agents/discovery/budget";
import { runPaidCall } from "@/lib/providers/paid-call";

describe.skipIf(!hasGtmTestDatabase)("Postgres discovery allowance", () => {
  let fixture: Awaited<ReturnType<typeof gtmPostgresFixture>>;
  beforeAll(async () => { fixture = await gtmPostgresFixture(); state.db = fixture.db; }, 60_000);
  afterAll(async () => { await fixture?.close(); });
  const reserve = (workspaceId: string, requestId: string, estimateUsd: number, scope: "initial" | "daily_review" = "initial") =>
    reserveDiscoverySpend({ workspaceId, requestId, estimateUsd, scope });
  const spent = async (workspaceId: string, scope = "initial") => Number((await fixture.client`
    select spent_usd from discovery_budget where workspace_id = ${workspaceId} and scope = ${scope}`)[0]?.spent_usd ?? 0);

  it("serializes concurrent reservations and preserves exact replay", async () => {
    const { workspaceId } = await fixture.seed();
    const attempts = await Promise.allSettled([reserve(workspaceId, "provider-a", 0.3), reserve(workspaceId, "provider-b", 0.3)]);
    expect(attempts.filter(x => x.status === "fulfilled")).toHaveLength(1);
    expect(await spent(workspaceId)).toBe(0.3);
    const winning = attempts.find(x => x.status === "fulfilled") as PromiseFulfilledResult<{ reservationId: string }>;
    const requestId = attempts[0]?.status === "fulfilled" ? "provider-a" : "provider-b";
    expect(await reserve(workspaceId, requestId, 0.3)).toEqual(winning.value);
    await expect(reserve(workspaceId, requestId, 0.2)).rejects.toThrow(/Conflicting discovery request ID/);
    expect(await spent(workspaceId)).toBe(0.3);
  });

  it("caps daily review at five cents and retains failed or unknown usage", async () => {
    const { workspaceId } = await fixture.seed();
    const one = await reserve(workspaceId, "linkup", 0.03, "daily_review");
    await expect(reserve(workspaceId, "gateway", 0.03, "daily_review")).rejects.toThrow();
    await settleDiscoverySpend({ workspaceId, reservationId: one.reservationId, outcome: "ambiguous" });
    await settleDiscoverySpend({ workspaceId, reservationId: one.reservationId, outcome: "ambiguous" });
    expect(await spent(workspaceId, "daily_review")).toBe(0.03);
    await expect(settleDiscoverySpend({ workspaceId, reservationId: one.reservationId, outcome: "success", actualUsd: 0 })).rejects.toThrow(/Conflicting discovery settlement/);
  });

  it("retains actual debt above estimate and refuses later work", async () => {
    const { workspaceId } = await fixture.seed();
    const one = await reserve(workspaceId, "model", 0.1);
    await settleDiscoverySpend({ workspaceId, reservationId: one.reservationId, outcome: "success", actualUsd: 0.4 });
    expect(await spent(workspaceId)).toBe(0.4);
    await expect(reserve(workspaceId, "tool", 0.11)).rejects.toThrow();
    await expect(settleDiscoverySpend({ workspaceId: crypto.randomUUID(), reservationId: one.reservationId, outcome: "success", actualUsd: 0.4 })).rejects.toThrow(/not found/);
  });

  it("retains known failed actual above estimate", async () => {
    const { workspaceId } = await fixture.seed();
    const one = await reserve(workspaceId, "failed-model", 0.1);
    await settleDiscoverySpend({ workspaceId, reservationId: one.reservationId, outcome: "failed", actualUsd: 0.4 });
    expect(await spent(workspaceId)).toBe(0.4);
    await expect(reserve(workspaceId, "next-tool", 0.11)).rejects.toThrow();
  });

  it("allows nested attempts from one server context but fences another while receipts are pending", async () => {
    const { workspaceId } = await fixture.seed();
    const [model, tool] = await withDiscoveryBudget({ workspaceId, scope: "initial", requestId: "same-run" }, async () => [
      await reserveDiscoveryAttempt(workspaceId, 0.1), await reserveDiscoveryAttempt(workspaceId, 0.1),
    ]);
    expect(model?.reservationId).toBeDefined();
    expect(tool?.reservationId).toBeDefined();
    const fresh = (requestId: string) => withDiscoveryBudget({ workspaceId, scope: "initial", requestId },
      () => reserveDiscoveryAttempt(workspaceId, 0.1));
    await expect(fresh("other-run")).rejects.toThrow("Discovery spend needs reconciliation");
    await expect(fresh("same-run:spoof")).rejects.toThrow("Discovery spend needs reconciliation");
    await model?.settle(0.1, "success");
    await tool?.settle(0.1, "success");
    expect(await fresh("other-run")).toHaveProperty("reservationId");
  });

  it("blocks a later paid run after an above-estimate settlement write fails until reconciliation", async () => {
    const { workspaceId } = await fixture.seed();
    vi.stubEnv("VANTAGE_PAID_PROVIDERS_ENABLED", "true");
    vi.stubEnv("VANTAGE_PAID_DAILY_BUDGET_USD", "2");
    const original = fixture.db as { execute: (query: unknown) => Promise<unknown> };
    const dialect = new PgDialect();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      state.db = new Proxy(original, { get(target, key) {
        if (key === "execute") return (query: unknown) => {
          if (dialect.sqlToQuery(query as never).sql.includes("settle_discovery_spend")) throw new Error("simulated settlement failure");
          return target.execute(query);
        };
        return Reflect.get(target, key);
      } });
      await withDiscoveryBudget({ workspaceId, scope: "initial", requestId: "failed-sql-run" }, async () => {
        await expect(runPaidCall({ context: { workspaceId, sourceKey: "discovery" }, provider: "gateway",
          action: "research_model", estimateUsd: 0.1 }, async () => ({ value: "billed", costUsd: 0.4 })))
          .rejects.toThrow("Discovery spend needs reconciliation");
      });
      state.db = fixture.db;
      const second = vi.fn(async () => ({ value: "second", costUsd: 0.01 }));
      await withDiscoveryBudget({ workspaceId, scope: "initial", requestId: "later-run" }, async () => {
        await expect(runPaidCall({ context: { workspaceId, sourceKey: "discovery" }, provider: "gateway",
          action: "research_model", estimateUsd: 0.1 }, second)).rejects.toThrow("Discovery spend needs reconciliation");
      });
      expect(second).not.toHaveBeenCalled();
      const [receipt] = await fixture.client`select id, settled_at from discovery_reservation where workspace_id = ${workspaceId} and request_id = 'failed-sql-run:1'`;
      expect(receipt?.settled_at).toBeNull();
      await settleDiscoverySpend({ workspaceId, reservationId: String(receipt?.id), actualUsd: 0.4, outcome: "success" });
      await settleDiscoverySpend({ workspaceId, reservationId: String(receipt?.id), actualUsd: 0.4, outcome: "success" });
      expect(await spent(workspaceId)).toBe(0.4);
      const later = vi.fn(async () => ({ value: "allowed", costUsd: 0.1 }));
      await withDiscoveryBudget({ workspaceId, scope: "initial", requestId: "after-reconciliation" }, async () => {
        await expect(runPaidCall({ context: { workspaceId, sourceKey: "discovery" }, provider: "gateway",
          action: "research_model", estimateUsd: 0.1 }, later)).resolves.toBe("allowed");
      });
      expect(later).toHaveBeenCalledOnce();
      expect(await spent(workspaceId)).toBe(0.5);
    } finally {
      state.db = fixture.db;
      vi.unstubAllEnvs();
      log.mockRestore();
    }
  });

  it("settles against the reservation's stored UTC period", async () => {
    const { workspaceId } = await fixture.seed();
    const one = await reserve(workspaceId, "daily-before-midnight", 0.02, "daily_review");
    await fixture.client`update discovery_budget set period = '2026-01-01'::date where workspace_id = ${workspaceId} and scope = 'daily_review'`;
    await fixture.client`update discovery_reservation set period = '2026-01-01'::date where id = ${one.reservationId}`;
    await settleDiscoverySpend({ workspaceId, reservationId: one.reservationId, outcome: "success", actualUsd: 0.01 });
    expect(Number((await fixture.client`select spent_usd from discovery_budget where workspace_id = ${workspaceId} and period = '2026-01-01'::date`)[0]?.spent_usd)).toBe(0.01);
    expect(await reserve(workspaceId, "new-day", 0.05, "daily_review")).toHaveProperty("reservationId");
  });

  it("obeys a lower effective plan cap and the feature gate", async () => {
    const { workspaceId } = await fixture.seed();
    await fixture.client`update plan_limit set value = 20 where plan = 'free' and key = 'discovery_initial_cents'`;
    try {
      await expect(reserve(workspaceId, "too-large", 0.21)).rejects.toThrow();
      await reserve(workspaceId, "fits", 0.2);
      expect(await spent(workspaceId)).toBe(0.2);
      await fixture.client`update plan_limit set value = 0 where plan = 'free' and key = 'discovery_reports'`;
      await expect(reserve(workspaceId, "feature-off", 0.01)).rejects.toThrow();
    } finally {
      await fixture.client`update plan_limit set value = 50 where plan = 'free' and key = 'discovery_initial_cents'`;
      await fixture.client`update plan_limit set value = 1 where plan = 'free' and key = 'discovery_reports'`;
    }
  });

  it("uses an active subscription's lower Pro cents cap", async () => {
    const { workspaceId } = await fixture.seed();
    const subscriptionId = `discovery-test-${crypto.randomUUID()}`;
    await fixture.client`insert into billing_subscription (id, user_id, polar_customer_id, product_id, plan, status)
      values (${subscriptionId}, 'gtm-test-owner', 'disposable', 'disposable', 'pro', 'active')`;
    await fixture.client`update plan_limit set value = 10 where plan = 'pro' and key = 'discovery_initial_cents'`;
    try {
      await expect(reserve(workspaceId, "pro-too-large", 0.11)).rejects.toThrow();
      await reserve(workspaceId, "pro-fits", 0.1);
      expect(await spent(workspaceId)).toBe(0.1);
    } finally {
      await fixture.client`update plan_limit set value = 50 where plan = 'pro' and key = 'discovery_initial_cents'`;
      await fixture.client`delete from billing_subscription where id = ${subscriptionId}`;
    }
  });
});
