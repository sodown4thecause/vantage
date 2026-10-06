import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as Array<{ unitCostUsd: string }>,
  fail: false,
  queries: 0,
}));

vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => {
              state.queries += 1;
              if (state.fail) throw new Error("relation provider_price does not exist");
              return state.rows;
            },
          }),
        }),
      }),
    }),
  }),
}));

import { clearPriceCache, DEFAULT_PRICES, getUnitCost } from "@/lib/costs/prices";

beforeEach(() => {
  state.rows = [];
  state.fail = false;
  state.queries = 0;
  clearPriceCache();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("getUnitCost", () => {
  it("prefers the provider_price row", async () => {
    state.rows = [{ unitCostUsd: "0.020000" }];
    expect(await getUnitCost("tinyfish", "agent_step")).toBe(0.02);
  });

  it("falls back to the hard-coded price when no row exists", async () => {
    expect(await getUnitCost("tinyfish", "agent_step")).toBe(0.016);
    expect(await getUnitCost("scrapecreators", "request")).toBe(0.0019);
  });

  it("falls back and does not throw when the table is missing", async () => {
    state.fail = true;
    expect(await getUnitCost("scavio", "reddit_search")).toBe(0.004);
  });

  it("prices unknown actions at zero", async () => {
    expect(await getUnitCost("nobody", "nothing")).toBe(0);
  });

  it("caches for 60 seconds then re-reads", async () => {
    vi.useFakeTimers();
    state.rows = [{ unitCostUsd: "0.020000" }];
    expect(await getUnitCost("tinyfish", "agent_step")).toBe(0.02);
    state.rows = [{ unitCostUsd: "0.030000" }];
    vi.advanceTimersByTime(59_000);
    expect(await getUnitCost("tinyfish", "agent_step")).toBe(0.02);
    expect(state.queries).toBe(1);
    vi.advanceTimersByTime(2_000);
    expect(await getUnitCost("tinyfish", "agent_step")).toBe(0.03);
    expect(state.queries).toBe(2);
  });

  it("does not cache lookups for an explicit date", async () => {
    state.rows = [{ unitCostUsd: "0.020000" }];
    await getUnitCost("tinyfish", "agent_step", new Date("2026-01-01"));
    await getUnitCost("tinyfish", "agent_step", new Date("2026-01-01"));
    expect(state.queries).toBe(2);
  });

  it("seeds every provider named in the slice", () => {
    const keys = DEFAULT_PRICES.map((p) => `${p.provider}/${p.action}`);
    expect(keys).toEqual(
      expect.arrayContaining([
        "tinyfish/agent_step",
        "tinyfish/search",
        "tinyfish/fetch",
        "scavio/reddit_search",
        "grok/x_search_post",
        "grok/score_post",
        "scrapecreators/request",
        "browser_run/browser_hour",
      ]),
    );
    expect(DEFAULT_PRICES.every((p) => p.notes.length > 0)).toBe(true);
  });
});
