import { beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const state = vi.hoisted(() => ({ reserved: 0, cost: 0, hydration: 0, capped: false, scopes: [] as string[] }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({ update: () => ({ set: (values: Record<string, unknown>) => ({ where: (condition: unknown) => {
  const apply = () => {
    const dialect = new PgDialect();
    const query = (value: unknown) => dialect.sqlToQuery(value as Parameters<PgDialect["sqlToQuery"]>[0]);
    state.scopes.push(JSON.stringify(query(condition)));
    if (values.capped) { state.capped = true; return []; }
    if (values.reservedUsd) {
      const estimate = Number(query(values.reservedUsd).params[0]);
      const hydration = Number(query(values.hydrationAttempts).params[0]);
      if (state.reserved + estimate > 0.1000001 || (hydration && state.hydration >= 5)) return [];
      state.reserved += estimate;
      state.cost += estimate;
      state.hydration += hydration;
      return [{ id: "first" }];
    }
    state.cost += Number(query(values.costUsd).params[0]);
    return [];
  };
  return { returning: async () => apply(), then: (ok: (value: unknown) => unknown) => Promise.resolve(apply()).then(ok) };
} }) }) }) }));

import { FIRST_SCAN_BUDGET_USD, reserveScanSpend, withFirstScanBudget } from "@/lib/activation/budget";
const WS = "11111111-1111-4111-8111-111111111111";
beforeEach(() => { state.reserved = 0; state.cost = 0; state.hydration = 0; state.capped = false; state.scopes = []; });

it("reserves concurrent search and hydration attempts atomically before work, never over the named cap", async () => {
  const results = await withFirstScanBudget(WS, `first-${WS}`, () => Promise.allSettled(Array.from({ length: 10 }, () => reserveScanSpend(WS, "firecrawl", "search", 0.03))));
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(3);
  expect(state.reserved).toBeLessThanOrEqual(FIRST_SCAN_BUDGET_USD);
  expect(state.capped).toBe(true);
  expect(state.scopes.every((scope) => scope.includes(WS) && scope.includes(`first-${WS}`))).toBe(true);
});

it("keeps the top-five-only hydration cap across requests, retries and source queries", async () => {
  for (let i = 0; i < 5; i++) {
    const attempt = await withFirstScanBudget(WS, `first-${WS}`, () => reserveScanSpend(WS, "scavio", "reddit_hydrate", 0.008));
    await attempt?.settle(0.008);
  }
  await expect(withFirstScanBudget(WS, `first-${WS}`, () => reserveScanSpend(WS, "scavio", "reddit_hydrate", 0.008))).rejects.toThrow();
  expect(state.hydration).toBe(5);
  expect(state.cost).toBeCloseTo(0.04);
  expect(state.capped).toBe(true);
});

it("blocks other paid fallbacks and foreign workspace attribution; untracked scans are unchanged", async () => {
  await expect(withFirstScanBudget(WS, `first-${WS}`, () => reserveScanSpend(WS, "tinyfish", "agent_step", 0.01))).rejects.toThrow();
  await expect(withFirstScanBudget(WS, `first-${WS}`, () => reserveScanSpend("foreign", "firecrawl", "search", 0.01))).rejects.toThrow();
  expect(state.reserved).toBe(0);
  expect(await reserveScanSpend(WS, "firecrawl", "search", 0.01)).toBeNull();
});
