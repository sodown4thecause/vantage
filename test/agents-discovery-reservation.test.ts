import { MockLanguageModelV4 } from "ai/test";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import { dbBudgetStore, reserveDiscoveryBudget, runDiscovery, type DiscoveryRunDeps } from "@/lib/agents/discovery";
import { memoryBudgetStore } from "./helpers/budget-store";

const state = vi.hoisted(() => ({ executed: [] as unknown[], result: [] as unknown[] }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({ execute: async (statement: unknown) => { state.executed.push(statement); return state.result; } }) }));

const WS = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-26T10:00:00Z");
const usage = { inputTokens: { total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 200, text: 200, reasoning: 0 } };
const done = { content: [{ type: "text" as const, text: "Done." }], finishReason: { unified: "stop" as const, raw: "stop" }, usage, warnings: [] };

describe("reserveDiscoveryBudget with a zero cap", () => {
  it("denies the run before any model call or reservation", async () => {
    const memory = memoryBudgetStore();
    await expect(reserveDiscoveryBudget(WS, "initial", { store: memory.store, env: { DISCOVERY_BUDGET_USD: "0" }, now: NOW }))
      .rejects.toMatchObject({ name: "PaidCallDeniedError", code: "budget_exhausted" });
    expect(memory.get(WS, "initial")).toBe(0);
  });
});

describe("reserveDiscoveryBudget", () => {
  it("reserves up to the per-run maximum and records it before any spend", async () => {
    const { store, get } = memoryBudgetStore();
    const handle = await reserveDiscoveryBudget(WS, "initial", { store, env: {}, now: NOW });
    expect(handle.reservedUsd).toBe(0.25);
    expect(get(WS, "initial")).toBe(0.25);
  });

  it("two simultaneous runs cannot both pass a cap that fits only one", async () => {
    const { store, get } = memoryBudgetStore({ [`${WS}|initial`]: 0.3 }); // $0.20 left: room for one reservation of it
    const settled = await Promise.allSettled([
      reserveDiscoveryBudget(WS, "initial", { store, env: {}, now: NOW }),
      reserveDiscoveryBudget(WS, "initial", { store, env: {}, now: NOW }),
    ]);
    expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const denied = settled.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(denied.reason).toMatchObject({ name: "PaidCallDeniedError", code: "budget_exhausted" });
    expect(get(WS, "initial")).toBeLessThanOrEqual(0.5);
  });

  it("many simultaneous runs never reserve more than the cap in total", async () => {
    const { store, get } = memoryBudgetStore();
    const settled = await Promise.allSettled(Array.from({ length: 8 }, () => reserveDiscoveryBudget(WS, "initial", { store, env: {}, now: NOW })));
    expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(2); // 2 x $0.25
    expect(get(WS, "initial")).toBeCloseTo(0.5, 6);
  });

  it("settles the actual cost, returning what was not spent", async () => {
    const { store, get } = memoryBudgetStore();
    const handle = await reserveDiscoveryBudget(WS, "initial", { store, env: {}, now: NOW });
    await handle.settle(0.04);
    expect(get(WS, "initial")).toBeCloseTo(0.04, 6);
  });

  it("denies when less than the least useful run is left", async () => {
    const { store } = memoryBudgetStore({ [`${WS}|initial`]: 0.49 });
    await expect(reserveDiscoveryBudget(WS, "initial", { store, env: {}, now: NOW })).rejects.toMatchObject({ code: "budget_exhausted" });
  });

  it("keeps review spend per UTC day, so a new day starts fresh", async () => {
    const { store, get } = memoryBudgetStore({ [`${WS}|day:2026-10-25`]: 0.05 });
    const handle = await reserveDiscoveryBudget(WS, "review", { store, env: {}, now: NOW });
    expect(handle.reservedUsd).toBe(0.05);
    expect(get(WS, "day:2026-10-26")).toBe(0.05);
    await expect(reserveDiscoveryBudget(WS, "review", { store, env: {}, now: NOW })).rejects.toMatchObject({ code: "budget_exhausted" });
  });

  it("honours DISCOVERY_BUDGET_USD and DISCOVERY_REVIEW_BUDGET_USD", async () => {
    const a = memoryBudgetStore();
    expect((await reserveDiscoveryBudget(WS, "initial", { store: a.store, env: { DISCOVERY_BUDGET_USD: "0.1" }, now: NOW })).reservedUsd).toBe(0.1);
    const b = memoryBudgetStore();
    expect((await reserveDiscoveryBudget(WS, "review", { store: b.store, env: { DISCOVERY_REVIEW_BUDGET_USD: "0.03" }, now: NOW })).reservedUsd).toBe(0.03);
  });

  it("denies, rather than running unmetered, when the budget store fails, and says it was an error and not a spent budget", async () => {
    const store = { committed: async () => { throw new Error("db down"); }, reserve: async () => true, settle: async () => undefined };
    await expect(reserveDiscoveryBudget(WS, "initial", { store, env: {}, now: NOW })).rejects.toMatchObject({ code: "access_pending" });
  });

  it("keeps the reservation counted when settling fails, which only over-counts", async () => {
    const { store, get } = memoryBudgetStore();
    const failing = { ...store, settle: async () => { throw new Error("db down"); } };
    const handle = await reserveDiscoveryBudget(WS, "initial", { store: failing, env: {}, now: NOW });
    await expect(handle.settle(0.01)).resolves.toBeUndefined();
    expect(get(WS, "initial")).toBe(0.25);
  });
});

describe("dbBudgetStore", () => {
  const sqlOf = (statement: unknown) => new PgDialect().sqlToQuery(statement as never);

  it("reserves in ONE conditional statement, so the cap check and the add cannot be split by a rival request", async () => {
    state.executed = []; state.result = [{ workspace_id: WS }];
    expect(await dbBudgetStore.reserve(WS, "initial", 0.25, 0.5)).toBe(true);
    expect(state.executed).toHaveLength(1);
    const { sql, params } = sqlOf(state.executed[0]);
    expect(sql).toMatch(/insert into discovery_budget/i);
    expect(sql).toMatch(/on conflict \(workspace_id, period\) do update/i);
    expect(sql).toMatch(/where discovery_budget\.committed_usd \+ excluded\.committed_usd <= /i);
    expect(sql).toMatch(/returning/i);
    expect(params).toContain(WS);
    // amount reserved (twice: the insert and the cap test) and the cap itself
    expect(params.filter((p) => p === "0.250000")).toHaveLength(2);
    expect(params.filter((p) => p === "0.500000")).toHaveLength(2);
  });

  it("reads what is committed for a workspace and period, as a number", async () => {
    state.executed = []; state.result = [{ committed_usd: "0.340000" }];
    expect(await dbBudgetStore.committed(WS, "initial")).toBeCloseTo(0.34, 6);
    const { sql, params } = sqlOf(state.executed[0]);
    expect(sql).toMatch(/from discovery_budget where workspace_id = /i);
    expect(params).toEqual([WS, "initial"]);
    state.result = [];
    expect(await dbBudgetStore.committed(WS, "initial")).toBe(0);
  });

  it("reports false when the conditional upsert changed nothing", async () => {
    state.executed = []; state.result = [];
    expect(await dbBudgetStore.reserve(WS, "initial", 0.25, 0.5)).toBe(false);
  });

  it("settles with a single statement scoped to the workspace and period", async () => {
    state.executed = []; state.result = [];
    await dbBudgetStore.settle(WS, "initial", 0.25, 0.04);
    expect(state.executed).toHaveLength(1);
    const { sql, params } = sqlOf(state.executed[0]);
    expect(sql).toMatch(/update discovery_budget/i);
    expect(sql).toMatch(/greatest\(0, committed_usd \+/i);
    expect(sql).toMatch(/workspace_id = /);
    // actual minus reserved: a run that spent $0.04 of $0.25 gives back $0.21
    expect(params).toContain("-0.210000");
    expect(params).toContain(WS);
  });
});

describe("runDiscovery with the reservation", () => {
  const baseDeps = (store: ReturnType<typeof memoryBudgetStore>["store"], over: Partial<DiscoveryRunDeps> = {}) => {
    const model = new MockLanguageModelV4({ doGenerate: done as never });
    const deps: DiscoveryRunDeps = {
      model, modelId: "anthropic/claude-sonnet-5.5", env: {}, now: NOW, store,
      runPaidCall: (async (_m: unknown, work: () => Promise<{ value?: unknown }>) => (await work()).value) as never,
      tools: { fetchPage: async (url) => ({ value: { url, markdown: "x" }, cached: false }), search: async () => ({ value: { results: [] }, cached: false }) },
      ...over,
    };
    return { deps, model };
  };

  it("two simultaneous discovery runs cannot both pass the cap: only one reaches the model", async () => {
    const { store, get } = memoryBudgetStore({ [`${WS}|initial`]: 0.47 }); // $0.03 left
    // The first run is still working (not yet settled) when the second asks, as with two real overlapping requests.
    const slow = (async (_m: unknown, work: () => Promise<{ value?: unknown }>) => { await new Promise((r) => setTimeout(r, 50)); return (await work()).value; }) as never;
    const { deps, model } = baseDeps(store, { runPaidCall: slow });
    const settled = await Promise.allSettled([
      runDiscovery({ workspaceId: WS, productUrl: "https://contextfor.dev/" }, deps),
      runDiscovery({ workspaceId: WS, productUrl: "https://contextfor.dev/" }, deps),
    ]);
    expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(settled.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "budget_exhausted" } });
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(get(WS, "initial")).toBeLessThanOrEqual(0.5);
  });

  it("caps a run at what it reserved, then settles the real spend", async () => {
    const { store, get } = memoryBudgetStore();
    const { deps } = baseDeps(store);
    const outcome = await runDiscovery({ workspaceId: WS, productUrl: "https://contextfor.dev/" }, deps);
    expect(outcome.status).toBe("complete");
    expect(get(WS, "initial")).toBeCloseTo((1000 * 2 + 200 * 10) / 1_000_000, 6);
  });

  it("returns the whole reservation when the run is denied before spending anything", async () => {
    const { store, get } = memoryBudgetStore();
    const { deps } = baseDeps(store, { runPaidCall: (async () => { throw new Error("providers disabled"); }) as never });
    await expect(runDiscovery({ workspaceId: WS, productUrl: "https://contextfor.dev/" }, deps)).rejects.toThrow("providers disabled");
    expect(get(WS, "initial")).toBe(0);
  });
});
