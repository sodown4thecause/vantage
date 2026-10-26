import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mock = vi.hoisted(() => ({ execute: vi.fn(), record: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({ execute: mock.execute }) }));
vi.mock("@/lib/costs/ledger", async original => ({ ...await original<typeof import("@/lib/costs/ledger")>(), recordCost: mock.record }));
import { DiscoveryBudgetError, reserveDiscoverySpend, settleDiscoverySpend, withDiscoveryBudget } from "@/lib/agents/discovery/budget";
import { runPaidCall } from "@/lib/providers/paid-call";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const dialect = new PgDialect();
const statements: Array<{ sql: string; params: unknown[] }> = [];
let reserved = 0;
let settled = 0;
const attemptIds = new Map<string, string>();
beforeEach(() => {
  statements.length = 0; reserved = 0; settled = 0;
  attemptIds.clear();
  vi.stubEnv("VANTAGE_PAID_PROVIDERS_ENABLED", "true");
  vi.stubEnv("VANTAGE_PAID_DAILY_BUDGET_USD", "2");
  mock.record.mockReset().mockResolvedValue(true);
  mock.execute.mockReset().mockImplementation(async query => {
    const built = dialect.sqlToQuery(query);
    statements.push(built);
    if (built.sql.includes("reserve_discovery_spend")) {
      reserved++;
      const request = String(built.params[3]);
      const prior = attemptIds.get(request);
      if (prior) return [{ id: prior, created: false }];
      attemptIds.set(request, String(built.params[0]));
      return [{ id: built.params[0], created: true }];
    }
    if (built.sql.includes("settle_discovery_spend")) { settled++; return []; }
    if (built.sql.includes("insert into provider_budget_reservation")) return [{ day: "2026-10-26" }];
    return [];
  });
});

describe("discovery budget boundary", () => {
  it("rejects invalid actual and estimate before SQL", async () => {
    await expect(reserveDiscoverySpend({ workspaceId, scope: "initial", requestId: "x", estimateUsd: Infinity })).rejects.toThrow();
    await expect(reserveDiscoverySpend({ workspaceId, scope: "initial", requestId: "x", estimateUsd: -1 })).rejects.toThrow();
    await expect(settleDiscoverySpend({ workspaceId, reservationId: crypto.randomUUID(), actualUsd: NaN, outcome: "success" })).rejects.toThrow();
    expect(statements).toHaveLength(0);
  });

  it("maps only known PostgreSQL domain errors and never exposes query parameters", async () => {
    const dbFailure = (message: string, code = "P0001") => Object.assign(new Error("Failed query: params: secret"), {
      cause: Object.assign(new Error(message), { code }),
    });
    mock.execute.mockRejectedValueOnce(dbFailure("Conflicting discovery request ID"));
    const conflict = await reserveDiscoverySpend({ workspaceId, scope: "initial", requestId: "same", estimateUsd: 0.1 }).catch(error => error);
    expect(conflict).toBeInstanceOf(DiscoveryBudgetError);
    expect(conflict.message).toBe("Conflicting discovery request ID");
    expect(String(conflict)).not.toContain("secret");
    mock.execute.mockRejectedValueOnce(dbFailure("Discovery reservation not found"));
    await expect(settleDiscoverySpend({ workspaceId, reservationId: crypto.randomUUID(), outcome: "ambiguous" }))
      .rejects.toThrow("Discovery reservation not found");
    mock.execute.mockRejectedValueOnce(dbFailure("attacker controlled text", "XX000"));
    await expect(reserveDiscoverySpend({ workspaceId, scope: "initial", requestId: "other", estimateUsd: 0.1 }))
      .rejects.toThrow("Discovery workspace budget unavailable.");
  });

  it("puts actual model and tool calls in the same workspace scope, once per paid attempt", async () => {
    await withDiscoveryBudget({ workspaceId, scope: "initial", requestId: "research-1" }, async () => {
      await runPaidCall({ context: { workspaceId, sourceKey: "discovery" }, provider: "gateway", action: "research_model", estimateUsd: 0.12 },
        async () => ({ value: "model", costUsd: 0.08 }));
      await runPaidCall({ context: { workspaceId, sourceKey: "discovery" }, provider: "linkup", action: "fetch_page", estimateUsd: 0.001 },
        async () => ({ value: "page", costUsd: 0.001 }));
    });
    expect(reserved).toBe(2);
    expect(settled).toBe(2);
    expect(mock.record).toHaveBeenCalledTimes(2);
    const receiptIds = statements.filter(s => s.sql.includes("reserve_discovery_spend")).map(s => s.params[0]);
    expect(mock.record.mock.calls.map(([entry]) => entry.requestRef)).toEqual(receiptIds);
    const requestIds = statements.filter(s => s.sql.includes("reserve_discovery_spend")).map(s => s.params[3]);
    expect(new Set(requestIds).size).toBe(2);
    expect(requestIds.every(id => String(id).startsWith("research-1:"))).toBe(true);
  });

  it("denies a replayed or concurrent attempt before a second provider dispatch", async () => {
    const work = vi.fn(async () => ({ value: "model", costUsd: 0.01 }));
    const run = () => withDiscoveryBudget({ workspaceId, scope: "initial", requestId: "same-turn" }, () =>
      runPaidCall({ context: { workspaceId, sourceKey: "discovery" }, provider: "gateway", action: "research_model", estimateUsd: 0.1 }, work));
    const results = await Promise.allSettled([run(), run()]);
    expect(results.filter(x => x.status === "fulfilled")).toHaveLength(1);
    expect(work).toHaveBeenCalledTimes(1);
    await expect(run()).rejects.toThrow(/already reserved/);
    expect(work).toHaveBeenCalledTimes(1);
    expect(attemptIds.size).toBe(1);
  });

  it("retains the upper estimate after a dispatched failure and post-dispatch ledger failure", async () => {
    await withDiscoveryBudget({ workspaceId, scope: "initial", requestId: "research-2" }, async () => {
      await expect(runPaidCall({ context: { workspaceId, sourceKey: "discovery" }, provider: "gateway", action: "research_model", estimateUsd: 0.2 },
        async () => { throw new Error("provider timeout"); })).rejects.toThrow("provider timeout");
      mock.record.mockResolvedValueOnce(false);
      await expect(runPaidCall({ context: { workspaceId, sourceKey: "discovery" }, provider: "gateway", action: "research_model", estimateUsd: 0.2 },
        async () => ({ value: "completed", costUsd: 0.01 }))).rejects.toThrow(/recording is pending/);
    });
    const settlements = statements.filter(s => s.sql.includes("settle_discovery_spend"));
    expect(settlements).toHaveLength(2);
    expect(settlements.map(s => s.params.slice(2))).toEqual([[null, "ambiguous"], ["0.010000", "ambiguous"]]);
  });

  it("passes a known over-estimate bill through failed and ledger-failed attempts", async () => {
    await withDiscoveryBudget({ workspaceId, scope: "initial", requestId: "known-bill" }, async () => {
      await expect(runPaidCall<string>({ context: { workspaceId, sourceKey: "discovery" }, provider: "gateway",
        action: "research_model", estimateUsd: 0.1 }, async () => ({ error: new Error("billed failure"), costUsd: 0.4 })))
        .rejects.toThrow("billed failure");
      mock.record.mockResolvedValueOnce(false);
      await expect(runPaidCall({ context: { workspaceId, sourceKey: "discovery" }, provider: "gateway",
        action: "research_model", estimateUsd: 0.1 }, async () => ({ value: "billed", costUsd: 0.4 })))
        .rejects.toThrow(/recording is pending/);
    });
    expect(statements.filter(s => s.sql.includes("settle_discovery_spend")).map(s => s.params.slice(2)))
      .toEqual([["0.400000", "failed"], ["0.400000", "ambiguous"]]);
    expect(statements.filter(s => s.sql.includes("update provider_budget_reservation") && s.params[0] === "0.300000")).toHaveLength(2);
  });

  it("marks the current context unsafe and refuses further work after settlement fails", async () => {
    const original = mock.execute.getMockImplementation()!;
    mock.execute.mockImplementation(async query => {
      if (dialect.sqlToQuery(query).sql.includes("settle_discovery_spend")) throw new Error("settlement database failure");
      return original(query);
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const first = vi.fn(async () => ({ value: "billed", costUsd: 0.4 }));
    const next = vi.fn(async () => ({ value: "more", costUsd: 0.01 }));
    try {
      await withDiscoveryBudget({ workspaceId, scope: "initial", requestId: "failed-settlement" }, async () => {
        await expect(runPaidCall({ context: { workspaceId, sourceKey: "discovery" }, provider: "gateway",
          action: "research_model", estimateUsd: 0.1 }, first)).rejects.toThrow(/needs reconciliation/);
        await expect(runPaidCall({ context: { workspaceId, sourceKey: "discovery" }, provider: "linkup",
          action: "fetch_page", estimateUsd: 0.001 }, next)).rejects.toThrow(/needs reconciliation/);
      });
    } finally { log.mockRestore(); }
    expect(first).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
    expect(reserved).toBe(1);
  });

  it("releases a proven pre-dispatch abort without calling the provider", async () => {
    const controller = new AbortController();
    const original = mock.execute.getMockImplementation()!;
    mock.execute.mockImplementation(async query => {
      const result = await original(query);
      if (dialect.sqlToQuery(query).sql.includes("reserve_discovery_spend")) controller.abort();
      return result;
    });
    const work = vi.fn();
    await withDiscoveryBudget({ workspaceId, scope: "initial", requestId: "research-abort" }, async () => {
      await expect(runPaidCall({ context: { workspaceId, sourceKey: "discovery" }, provider: "gateway",
        action: "research_model", estimateUsd: 0.2, signal: controller.signal }, work)).rejects.toThrow();
    });
    expect(work).not.toHaveBeenCalled();
    expect(mock.record).not.toHaveBeenCalled();
    const settlement = statements.find(s => s.sql.includes("settle_discovery_spend"));
    expect(settlement?.params.slice(2)).toEqual(["0.000000", "success"]);
  });
});
