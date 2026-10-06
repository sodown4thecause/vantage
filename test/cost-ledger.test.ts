import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  inserted: [] as Array<Record<string, unknown>>,
  fail: false,
}));

vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    insert: () => ({
      values: async (values: Record<string, unknown>) => {
        if (state.fail) throw new Error("db down");
        state.inserted.push(values);
      },
    }),
  }),
}));

import { computeCost, recordCost, roundUsd } from "@/lib/costs/ledger";

beforeEach(() => {
  state.inserted = [];
  state.fail = false;
  vi.restoreAllMocks();
});

describe("computeCost", () => {
  it("multiplies units by unit price at six decimal places", () => {
    expect(computeCost({ sourceKey: "x", provider: "scrapecreators", action: "linkedin", units: 3, unitCostUsd: 0.0019 })).toEqual({
      units: "3",
      unitCostUsd: "0.001900",
      costUsd: "0.005700",
    });
  });

  it("defaults to one unit", () => {
    expect(computeCost({ sourceKey: "reddit", provider: "tinyfish", action: "agent", unitCostUsd: 0.016 }).costUsd).toBe("0.016000");
  });

  it("records failed calls at zero unless the provider charges anyway", () => {
    const base = { sourceKey: "reddit", provider: "tinyfish", action: "agent", units: 12, unitCostUsd: 0.016, ok: false };
    expect(computeCost(base).costUsd).toBe("0.000000");
    expect(computeCost({ ...base, chargedOnFailure: true }).costUsd).toBe("0.192000");
  });

  it("avoids float drift", () => {
    expect(roundUsd(0.1 * 3)).toBe(0.3);
    expect(computeCost({ sourceKey: "x", provider: "xai", action: "post", units: 25, unitCostUsd: 0.005 }).costUsd).toBe("0.125000");
  });

  it("prices from the stored 6 dp unit price so cost matches its own columns", () => {
    const row = computeCost({ sourceKey: "x", provider: "p", action: "a", units: 1000, unitCostUsd: 0.0000004 });
    expect(row.unitCostUsd).toBe("0.000000");
    expect(row.costUsd).toBe("0.000000");
    const priced = computeCost({ sourceKey: "x", provider: "p", action: "a", units: 3, unitCostUsd: 0.0019 });
    expect(Number(priced.units) * Number(priced.unitCostUsd)).toBeCloseTo(Number(priced.costUsd), 6);
  });

  it("rejects negative or non-finite inputs", () => {
    expect(() => computeCost({ sourceKey: "x", provider: "p", action: "a", units: -1, unitCostUsd: 1 })).toThrow();
    expect(() => computeCost({ sourceKey: "x", provider: "p", action: "a", unitCostUsd: Number.NaN })).toThrow();
  });
});

describe("recordCost", () => {
  it("inserts a ledger row with defaults", async () => {
    const ok = await recordCost({ sourceKey: "x", provider: "xai", action: "x_search", units: 25, unitCostUsd: 0.005, workspaceId: "w1" });
    expect(ok).toBe(true);
    expect(state.inserted[0]).toMatchObject({
      sourceKey: "x",
      provider: "xai",
      workspaceId: "w1",
      billableTo: "platform",
      ok: true,
      costUsd: "0.125000",
    });
  });

  it("never throws when the ledger write fails", async () => {
    state.fail = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(recordCost({ sourceKey: "x", provider: "p", action: "a", unitCostUsd: 1 })).resolves.toBe(false);
  });

  it("does not write when the input is invalid", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(recordCost({ sourceKey: "x", provider: "p", action: "a", unitCostUsd: -1 })).resolves.toBe(false);
    expect(state.inserted).toHaveLength(0);
  });
});
