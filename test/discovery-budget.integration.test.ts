import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { gtmPostgresFixture, hasGtmTestDatabase } from "./gtm-postgres-fixture";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db/client", () => ({ getDb: () => state.db }));
import { reserveDiscoverySpend, settleDiscoverySpend } from "@/lib/agents/discovery/budget";

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
});
