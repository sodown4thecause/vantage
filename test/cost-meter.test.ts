import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  recorded: [] as Array<Record<string, unknown>>,
  executed: [] as unknown[],
  failExecute: false,
  ledgerDown: false,
}));

vi.mock("@/lib/costs/ledger", () => ({
  recordCost: async (input: Record<string, unknown>) => {
    if (state.ledgerDown) throw new Error("ledger down");
    state.recorded.push(input);
    return true;
  },
}));
vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    // price lookup: no provider_price rows, so the hard-coded fallback applies
    select: () => ({
      from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }) }) }),
    }),
    execute: async (q: unknown) => {
      if (state.failExecute) throw new Error("relation cost_daily does not exist");
      state.executed.push(q);
    },
  }),
}));

import { PgDialect } from "drizzle-orm/pg-core";

import { withCost } from "@/lib/costs/meter";
import { clearPriceCache } from "@/lib/costs/prices";
import { rollupDay, rollupRecent } from "@/lib/costs/rollup";

beforeEach(() => {
  state.recorded = [];
  state.executed = [];
  state.failExecute = false;
  state.ledgerDown = false;
  clearPriceCache();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("withCost", () => {
  it("records one successful event with priced units", async () => {
    const out = await withCost(
      { sourceKey: "reddit", provider: "tinyfish", action: "agent_step", workspaceId: "ws-1", units: (r: { steps: number }) => r.steps },
      async () => ({ steps: 5 }),
    );
    expect(out).toEqual({ steps: 5 });
    expect(state.recorded).toHaveLength(1);
    expect(state.recorded[0]).toMatchObject({
      sourceKey: "reddit",
      provider: "tinyfish",
      action: "agent_step",
      workspaceId: "ws-1",
      units: 5,
      unitCostUsd: 0.016,
      ok: true,
    });
  });

  it("records a failure with ok=false and rethrows the provider error unchanged", async () => {
    const boom = new Error("provider 500");
    await expect(
      withCost({ sourceKey: "x", provider: "scavio", action: "x_search" }, async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(state.recorded).toHaveLength(1);
    expect(state.recorded[0]).toMatchObject({ ok: false, chargedOnFailure: undefined });
  });

  it("passes chargedOnFailure through so the ledger can charge failed calls", async () => {
    await expect(
      withCost(
        { sourceKey: "x", provider: "scavio", action: "x_search", chargedOnFailure: true },
        async () => {
          throw new Error("nope");
        },
      ),
    ).rejects.toThrow("nope");
    expect(state.recorded[0]).toMatchObject({ ok: false, chargedOnFailure: true });
  });

  it("records a returned-but-failed result (isFailure) as ok=false and returns it", async () => {
    const out = await withCost(
      { sourceKey: "reddit", provider: "tinyfish", action: "agent_step", isFailure: (r: { status: string }) => r.status !== "COMPLETED" },
      async () => ({ status: "FAILED" }),
    );
    expect(out).toEqual({ status: "FAILED" });
    expect(state.recorded[0]).toMatchObject({ ok: false });
  });

  it("still returns the provider result when the ledger is down", async () => {
    state.ledgerDown = true;
    await expect(
      withCost({ sourceKey: "reddit", provider: "scavio", action: "reddit_search" }, async () => 42),
    ).resolves.toBe(42);
  });

  it("falls back to one unit when the units callback throws", async () => {
    await withCost(
      { sourceKey: "reddit", provider: "scavio", action: "reddit_search", units: () => { throw new Error("bad"); } },
      async () => 1,
    );
    expect(state.recorded[0]).toMatchObject({ units: 1 });
  });
});

describe("rollupDay", () => {
  const dialect = new PgDialect();
  const text = (q: unknown) => dialect.sqlToQuery(q as Parameters<PgDialect["sqlToQuery"]>[0]);

  it("is one idempotent upsert that recomputes totals from cost_event", async () => {
    await rollupDay("2026-10-05");
    await rollupDay("2026-10-05");
    expect(state.executed).toHaveLength(2);
    const [a, b] = state.executed.map(text);
    expect(a).toEqual(b);
    expect(a.sql).toContain("INSERT INTO cost_daily");
    expect(a.sql).toContain("FROM cost_event");
    expect(a.sql).toContain("ON CONFLICT (day, source_key, provider, action) DO UPDATE");
    // totals are overwritten from EXCLUDED, never incremented, so reruns cannot double count
    expect(a.sql).toContain("calls = EXCLUDED.calls");
    expect(a.sql).not.toMatch(/calls\s*=\s*cost_daily\.calls\s*\+/);
    expect(a.params).toContain("2026-10-05");
  });

  it("rejects malformed days", async () => {
    await expect(rollupDay("yesterday")).rejects.toThrow();
    expect(state.executed).toHaveLength(0);
  });

  it("rollupRecent covers yesterday and today and never throws", async () => {
    await rollupRecent(new Date("2026-10-06T12:00:00Z"));
    expect(state.executed.map((q) => text(q).params[0])).toEqual(["2026-10-05", "2026-10-06"]);
    state.failExecute = true;
    await expect(rollupRecent(new Date("2026-10-06T12:00:00Z"))).resolves.toBeUndefined();
  });
});
