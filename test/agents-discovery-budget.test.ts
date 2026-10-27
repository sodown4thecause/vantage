import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_INITIAL_BUDGET_USD,
  DEFAULT_REVIEW_DAILY_BUDGET_USD,
  assertDiscoveryBudget,
  discoveryBudgetUsd,
  remainingDiscoveryBudgetUsd,
  reviewDailyBudgetUsd,
  utcDayStart,
} from "@/lib/agents/discovery";
import { PaidCallDeniedError } from "@/lib/providers/paid-call";

describe("a cap of zero", () => {
  it("is a real cap, not an unset value", () => {
    expect(discoveryBudgetUsd({ DISCOVERY_BUDGET_USD: "0" })).toBe(0);
    expect(reviewDailyBudgetUsd({ DISCOVERY_REVIEW_BUDGET_USD: "0" })).toBe(0);
    expect(discoveryBudgetUsd({ DISCOVERY_BUDGET_USD: "-1" })).toBe(DEFAULT_INITIAL_BUDGET_USD);
    expect(discoveryBudgetUsd({ DISCOVERY_BUDGET_USD: "abc" })).toBe(DEFAULT_INITIAL_BUDGET_USD);
    expect(discoveryBudgetUsd({})).toBe(DEFAULT_INITIAL_BUDGET_USD);
  });
});

describe("discovery budget", () => {
  it("defaults to $0.50 for initial discovery and $0.05 a day for review loops", () => {
    expect(DEFAULT_INITIAL_BUDGET_USD).toBe(0.5);
    expect(DEFAULT_REVIEW_DAILY_BUDGET_USD).toBe(0.05);
    expect(discoveryBudgetUsd({})).toBe(0.5);
    expect(reviewDailyBudgetUsd({})).toBe(0.05);
  });

  it("reads DISCOVERY_BUDGET_USD and ignores blank, negative or malformed values (zero is a real cap)", () => {
    expect(discoveryBudgetUsd({ DISCOVERY_BUDGET_USD: "0.25" })).toBe(0.25);
    for (const bad of ["", "  ", "-1", "abc", "NaN", "Infinity"]) {
      expect(discoveryBudgetUsd({ DISCOVERY_BUDGET_USD: bad })).toBe(0.5);
    }
    expect(reviewDailyBudgetUsd({ DISCOVERY_REVIEW_BUDGET_USD: "0.1" })).toBe(0.1);
  });

  it("counts initial discovery spend over all time and review spend since UTC midnight", async () => {
    const readSpent = vi.fn(async () => 0.2);
    const now = new Date("2026-10-26T23:30:00+10:00"); // 13:30 UTC on 26 Oct
    const initial = await remainingDiscoveryBudgetUsd("ws", "initial", { readSpent, env: {}, now });
    expect(initial).toBeCloseTo(0.3, 6);
    expect(readSpent).toHaveBeenLastCalledWith("ws", "discovery", undefined);

    const review = await remainingDiscoveryBudgetUsd("ws", "review", { readSpent, env: {}, now });
    expect(review).toBeCloseTo(0, 6); // 0.05 cap, 0.20 spent: floored at zero
    expect(readSpent).toHaveBeenLastCalledWith("ws", "discovery_review", new Date("2026-10-26T00:00:00.000Z"));
  });

  it("denies the call when less than the next call's estimate remains", async () => {
    const readSpent = async () => 0.49;
    await expect(assertDiscoveryBudget("ws", "initial", 0.05, { readSpent, env: {} }))
      .rejects.toMatchObject({ name: "PaidCallDeniedError", code: "budget_exhausted" });
    await expect(assertDiscoveryBudget("ws", "initial", 0.01, { readSpent, env: {} })).resolves.toBeCloseTo(0.01, 6);
    await expect(assertDiscoveryBudget("ws", "initial", 0.05, { readSpent, env: {} })).rejects.toBeInstanceOf(PaidCallDeniedError);
  });

  it("starts the UTC day at midnight UTC", () => {
    expect(utcDayStart(new Date("2026-10-26T00:00:00Z")).toISOString()).toBe("2026-10-26T00:00:00.000Z");
    expect(utcDayStart(new Date("2026-10-26T23:59:59Z")).toISOString()).toBe("2026-10-26T00:00:00.000Z");
  });
});
