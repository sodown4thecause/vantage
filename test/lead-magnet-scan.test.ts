import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  scans: new Map<string, number>(),
  budget: new Map<string, { spent: number; cap: number }>(),
  sources: [] as Array<Record<string, unknown>>,
  collectorRuns: 0,
  statements: [] as string[],
}));

// Emulates the two guarded upserts (per-user cap and shared daily budget).
// Each execute() is one indivisible statement, mirroring Postgres semantics.
vi.mock("@/lib/db/client", () => {
  const dialect = new PgDialect();
  return {
    getDb: () => ({
      execute: async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
        const { sql: text, params } = dialect.sqlToQuery(query);
        state.statements.push(text);
        if (text.includes("lead_magnet_scan")) {
          if (text.includes("insert into")) {
            const key = `${params[0]}|${params[1]}`;
            const cap = Number(params[2]);
            const n = state.scans.get(key) ?? 0;
            if (n >= cap) return { rows: [] };
            state.scans.set(key, n + 1);
            return { rows: [{ scans: n + 1 }] };
          }
          // release
          const key = `${params[0]}|${params[1]}`;
          const n = state.scans.get(key) ?? 0;
          state.scans.set(key, Math.max(0, n - 1));
          return { rows: [] };
        }
        if (text.includes("budget_day")) {
          if (text.includes("insert into")) {
            const day = String(params[0]);
            const est = Number(params[1]);
            const cap = Number(params[2]);
            const row = state.budget.get(day);
            if (!row) {
              if (est > cap) return { rows: [] };
              state.budget.set(day, { spent: est, cap });
              return { rows: [{ spent_usd: est }] };
            }
            if (row.spent + est > cap) return { rows: [] };
            row.spent += est;
            row.cap = cap;
            return { rows: [{ spent_usd: row.spent }] };
          }
          // refund
          const day = String(params[1]);
          const row = state.budget.get(day);
          if (row) row.spent = Math.max(0, row.spent - Number(params[0]));
          return { rows: [] };
        }
        return { rows: [] };
      },
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({ limit: async () => state.sources }),
            limit: async () => [],
          }),
        }),
      }),
    }),
  };
});

vi.mock("@/lib/cron/lease", () => ({
  withWorkspaceScanLease: async (_id: string, run: (signal: AbortSignal) => Promise<unknown>) =>
    run(new AbortController().signal),
}));
vi.mock("@/lib/collectors/registry", () => ({
  collectorsByType: { hn: { name: "hn" }, rss: { name: "rss" } },
}));
vi.mock("@/lib/collectors/run", () => ({
  runCollector: async () => {
    state.collectorRuns++;
    return { sourceId: "s", collector: "hn", inserted: 2, skipped: 0 };
  },
}));
vi.mock("@/lib/opportunities/run", () => ({
  buildOpportunities: async () => ({ scanned: 3, clusters: 1, upserted: 1, top: [] }),
  listOpportunityQueue: async () => [
    { id: "o1", title: "Need a tool", score: 0.8, confidence: 0.7, evidenceCount: 2 },
  ],
}));

import { FREE_SCAN_ESTIMATE_USD, FREE_SCAN_SOURCE_TYPES } from "@/lib/lead-magnet/definition";
import {
  claimFreeScan,
  freeScansUsedToday,
  refundFreeScanBudget,
  releaseFreeScan,
  reserveFreeScanBudget,
} from "@/lib/lead-magnet/repository";
import { runFreeScan } from "@/lib/lead-magnet/run";

beforeEach(() => {
  state.scans.clear();
  state.budget.clear();
  state.statements = [];
  state.collectorRuns = 0;
  state.sources = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("free basic scan definition", () => {
  it("limits the free scan to the free lane source types", () => {
    expect([...FREE_SCAN_SOURCE_TYPES]).toEqual(["hn", "rss", "substack"]);
  });
});

describe("per-user daily cap", () => {
  it("allows one scan per workspace per day and refuses the second", async () => {
    expect(await claimFreeScan("ws-1", new Date("2026-10-07T10:00:00Z"))).toEqual({ allowed: true });
    const second = await claimFreeScan("ws-1", new Date("2026-10-07T11:00:00Z"));
    expect(second.allowed).toBe(false);
    if (!second.allowed) expect(second.reason).toBe("per_user_limit");
  });

  it("does not charge one workspace's cap against another", async () => {
    await claimFreeScan("ws-1", new Date("2026-10-07T10:00:00Z"));
    expect((await claimFreeScan("ws-2", new Date("2026-10-07T10:00:00Z"))).allowed).toBe(true);
  });

  it("resets at the next UTC day", async () => {
    await claimFreeScan("ws-1", new Date("2026-10-07T23:59:00Z"));
    expect((await claimFreeScan("ws-1", new Date("2026-10-08T00:01:00Z"))).allowed).toBe(true);
  });

  it("releases a claim and never drops below zero", async () => {
    await claimFreeScan("ws-1", new Date("2026-10-07T10:00:00Z"));
    await releaseFreeScan("ws-1", new Date("2026-10-07T10:05:00Z"));
    expect(await freeScansUsedToday("ws-1", new Date("2026-10-07T10:06:00Z"))).toBe(0);
    await releaseFreeScan("ws-1", new Date("2026-10-07T10:07:00Z"));
    expect(await freeScansUsedToday("ws-1", new Date("2026-10-07T10:08:00Z"))).toBe(0);
  });
});

describe("global daily budget", () => {
  it("grants a reservation under the cap and refuses once exhausted", async () => {
    const day = "2026-10-07";
    expect((await reserveFreeScanBudget(FREE_SCAN_ESTIMATE_USD, { day, capUsd: 0.06 })).allowed).toBe(true);
    const second = await reserveFreeScanBudget(FREE_SCAN_ESTIMATE_USD, { day, capUsd: 0.06 });
    expect(second.allowed).toBe(false);
    if (!second.allowed) expect(second.reason).toBe("budget_exhausted");
  });

  it("refunds a reservation whose scan failed", async () => {
    const day = "2026-10-07";
    const claim = await reserveFreeScanBudget(FREE_SCAN_ESTIMATE_USD, { day, capUsd: 5 });
    expect(claim.allowed).toBe(true);
    await refundFreeScanBudget(day, FREE_SCAN_ESTIMATE_USD);
    expect(state.budget.get(day)!.spent).toBe(0);
  });
});

describe("runFreeScan", () => {
  it("claims the cap first and refuses a second run the same day", async () => {
    state.sources = [{ id: "s1", type: "hn", name: "HN", lane: "free", health: "healthy" }];
    const first = await runFreeScan("ws-1");
    expect(first.ok).toBe(true);
    const second = await runFreeScan("ws-1");
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("per_user_limit");
  });

  it("returns the freed queue after scanning free sources", async () => {
    state.sources = [{ id: "s1", type: "hn", name: "HN", lane: "free", health: "healthy" }];
    const result = await runFreeScan("ws-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sourcesUsed).toEqual(["hn"]);
      expect(result.cards).toHaveLength(1);
      expect(result.documentsScanned).toBe(3);
      expect(state.collectorRuns).toBe(1);
    }
  });

  it("returns queued_not_error when the daily budget is exhausted", async () => {
    state.sources = [{ id: "s1", type: "hn", name: "HN", lane: "free", health: "healthy" }];
    const day = new Date().toISOString().slice(0, 10);
    state.budget.set(day, { spent: 100, cap: 5 });
    const result = await runFreeScan("ws-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("budget_exhausted");
    // The failed budget reservation must release the per-user claim for a retry.
    expect(await freeScansUsedToday("ws-1")).toBe(0);
  });

  it("reports no_sources without paying when nothing is configured", async () => {
    state.sources = [];
    const result = await runFreeScan("ws-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_sources");
  });

  it("reserves the budget in a single guarded SQL statement", async () => {
    state.sources = [{ id: "s1", type: "hn", name: "HN", lane: "free", health: "healthy" }];
    await runFreeScan("ws-1");
    const budgetStatements = state.statements.filter((s) => s.includes("budget_day"));
    expect(budgetStatements).toHaveLength(1);
    expect(budgetStatements[0]).toMatch(/on conflict \("day"\) do update/);
  });
});
