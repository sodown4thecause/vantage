import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({ execute: vi.fn(), record: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({ execute: mocks.execute }) }));
vi.mock("@/lib/costs/ledger", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/costs/ledger")>(), recordCost: mocks.record }));

import { runPaidCall, PaidCallDeniedError } from "@/lib/providers/paid-call";

const meta = { context: { workspaceId: "ws", sourceKey: "draft" }, provider: "gateway", action: "draft", estimateUsd: 0.1 };

describe("paid provider reservations", () => {
  beforeEach(() => {
    vi.stubEnv("VANTAGE_PAID_PROVIDERS_ENABLED", "true");
    vi.stubEnv("VANTAGE_PAID_DAILY_BUDGET_USD", "2");
    mocks.execute.mockReset().mockResolvedValue([{ day: "2026-10-07" }]);
    mocks.record.mockReset().mockResolvedValue(true);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("denies paid work before contacting a provider when the switch is off", async () => {
    vi.stubEnv("VANTAGE_PAID_PROVIDERS_ENABLED", "false");
    const work = vi.fn();
    await expect(runPaidCall(meta, work)).rejects.toBeInstanceOf(PaidCallDeniedError);
    expect(work).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("requires an explicit positive budget and workspace attribution", async () => {
    const work = vi.fn();
    vi.stubEnv("VANTAGE_PAID_DAILY_BUDGET_USD", "");
    await expect(runPaidCall(meta, work)).rejects.toThrow(/budget/i);
    vi.stubEnv("VANTAGE_PAID_DAILY_BUDGET_USD", "2");
    await expect(runPaidCall({ ...meta, context: { sourceKey: "draft" } }, work)).rejects.toThrow(/workspace/i);
    expect(work).not.toHaveBeenCalled();
  });

  it("denies when an atomic reservation cannot fit the cap", async () => {
    mocks.execute.mockResolvedValue([]);
    const work = vi.fn();
    await expect(runPaidCall(meta, work)).rejects.toThrow(/budget/i);
    expect(work).not.toHaveBeenCalled();
  });

  it("fails closed on budget database failure", async () => {
    mocks.execute.mockRejectedValue(new Error("database down"));
    const work = vi.fn();
    await expect(runPaidCall(meta, work)).rejects.toThrow(/budget/i);
    expect(work).not.toHaveBeenCalled();
  });

  it("records actual provider cost and releases only the unused reservation", async () => {
    const value = await runPaidCall(meta, async () => ({ value: "result", costUsd: 0.04 }));
    expect(value).toBe("result");
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ unitCostUsd: 0.04, units: 1, ok: true }));
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it("keeps the reservation and records an estimate on an ambiguous provider failure", async () => {
    await expect(runPaidCall(meta, async () => { throw new Error("timeout"); })).rejects.toThrow("timeout");
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ unitCostUsd: 0.1, ok: false, chargedOnFailure: true }));
  });

  it("does no work when the caller has already aborted", async () => {
    const controller = new AbortController(); controller.abort();
    const work = vi.fn();
    await expect(runPaidCall({ ...meta, signal: controller.signal }, work)).rejects.toThrow();
    expect(work).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("durably blocks later paid work when known cost settlement fails", async () => {
    let active = false;
    mocks.execute.mockImplementation(async query => {
      const compiled = new PgDialect().sqlToQuery(query);
      if (compiled.sql.includes("insert into provider_budget_day")) {
        expect(compiled.sql).toContain("provider_budget_day.reservation_ref is null");
        if (active) return [];
        active = true; return [{ day: "2026-10-07" }];
      }
      throw new Error("settlement unavailable");
    });
    const actual = vi.fn(async () => ({ value: "result", costUsd: 3 }));
    await expect(runPaidCall(meta, actual)).rejects.toBeInstanceOf(PaidCallDeniedError);
    expect(actual).toHaveBeenCalledOnce();
    const next = vi.fn();
    await expect(runPaidCall(meta, next)).rejects.toBeInstanceOf(PaidCallDeniedError);
    expect(next).not.toHaveBeenCalled();
  });
  it("releases an aborted reservation without charging a provider call which never started", async () => {
    const controller = new AbortController();
    mocks.execute.mockImplementationOnce(async () => { controller.abort(); return [{ day: "2026-10-07" }]; });
    const work = vi.fn();
    await expect(runPaidCall({ ...meta, signal: controller.signal }, work)).rejects.toThrow();
    expect(work).not.toHaveBeenCalled(); expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });
});
