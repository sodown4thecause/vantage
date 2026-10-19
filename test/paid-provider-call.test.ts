import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({ execute: vi.fn(), record: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({ execute: mocks.execute }) }));
vi.mock("@/lib/costs/ledger", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/costs/ledger")>(), recordCost: mocks.record }));

import { runPaidCall, PaidCallDeniedError } from "@/lib/providers/paid-call";

const meta = { context: { workspaceId: "ws", sourceKey: "draft" }, provider: "gateway", action: "draft", estimateUsd: 0.1 };
const dialect = new PgDialect();

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

/** Compiled reserve statements (`insert into provider_budget_reservation`), in call order. */
function reserveQueries() {
  return mocks.execute.mock.calls
    .map(([query]) => dialect.sqlToQuery(query))
    .filter(query => query.sql.includes("insert into provider_budget_reservation"));
}

/**
 * In-memory stand-in for provider_budget_reservation keyed by (day, provider). It applies the
 * reserve and settle guards from the SQL, so budgets can be exercised per provider.
 * Reserve params are [day, provider, estimate, cap, ...]; settle params are [delta, day, provider].
 */
function fakeReservations() {
  const rows = new Map<string, { spent: number; cap: number }>();
  mocks.execute.mockImplementation(async query => {
    const compiled = dialect.sqlToQuery(query);
    if (compiled.sql.includes("insert into provider_budget_reservation")) {
      const [day, provider, estimate, cap] = compiled.params as string[];
      const key = `${day}|${provider}`;
      const est = Number(estimate);
      const capUsd = Number(cap);
      const current = rows.get(key);
      if (!current) {
        if (est > capUsd) return [];
        rows.set(key, { spent: est, cap: capUsd });
        return [{ day }];
      }
      if (current.spent + est > capUsd) return [];
      current.spent += est;
      current.cap = capUsd;
      return [{ day }];
    }
    if (compiled.sql.includes("update provider_budget_reservation")) {
      const [delta, day, provider] = compiled.params as string[];
      const row = rows.get(`${day}|${provider}`);
      if (row) row.spent = Math.max(0, row.spent + Number(delta));
      return [];
    }
    throw new Error(`unexpected statement: ${compiled.sql}`);
  });
  return rows;
}

describe("paid provider reservations", () => {
  beforeEach(() => {
    vi.stubEnv("VANTAGE_PAID_PROVIDERS_ENABLED", "true");
    vi.stubEnv("VANTAGE_PAID_DAILY_BUDGET_USD", "2");
    mocks.execute.mockReset().mockResolvedValue([{ day: "2026-10-07" }]);
    mocks.record.mockReset().mockResolvedValue(true);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

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

  it("reserves one row per provider with an atomic guard and no reservation lock", async () => {
    await runPaidCall(meta, async () => ({ value: "result", costUsd: 0.04 }));
    const [reserve] = reserveQueries();
    expect(reserve.sql).toMatch(/on conflict \(day, provider\) do update[\s\S]*where provider_budget_reservation\.spent_usd \+ excluded\.spent_usd <= excluded\.cap_usd/);
    expect(reserve.sql).not.toContain("reservation_ref");
    expect(reserve.params).toEqual(expect.arrayContaining(["gateway"]));
    expect(mocks.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query).sql).join("\n")).not.toContain("provider_budget_day");
  });

  it("records actual provider cost and releases only the unused reservation", async () => {
    const value = await runPaidCall(meta, async () => ({ value: "result", costUsd: 0.04 }));
    expect(value).toBe("result");
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ unitCostUsd: 0.04, units: 1, ok: true }));
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it.each([0.25, 0])("settles known failed retrieval cost %s and rethrows its error", async costUsd => {
    const error = new Error("Unusable provider response");
    await expect(runPaidCall<string>(meta, async () => ({ error, costUsd }))).rejects.toBe(error);
    expect(mocks.record).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      unitCostUsd: costUsd, ok: false, chargedOnFailure: true,
    }));
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    const settlement = dialect.sqlToQuery(mocks.execute.mock.calls[1][0]);
    expect(settlement.sql).toContain("update provider_budget_reservation");
    expect(settlement.sql).not.toContain("reservation_ref");
    expect(settlement.params).toEqual(expect.arrayContaining([(costUsd - meta.estimateUsd).toFixed(6), "gateway"]));
  });

  it("retains the reservation if known failed retrieval usage cannot be recorded", async () => {
    mocks.record.mockResolvedValue(false);
    await expect(runPaidCall<string>(meta, async () => ({
      error: new Error("Unusable provider response"), costUsd: 0.25,
    }))).rejects.toBeInstanceOf(PaidCallDeniedError);
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ unitCostUsd: 0.25, ok: false }));
    expect(mocks.execute).toHaveBeenCalledOnce();
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

  it("releases an aborted reservation without charging a provider call which never started", async () => {
    const controller = new AbortController();
    mocks.execute.mockImplementationOnce(async () => { controller.abort(); return [{ day: "2026-10-07" }]; });
    const work = vi.fn();
    await expect(runPaidCall({ ...meta, signal: controller.signal }, work)).rejects.toThrow();
    expect(work).not.toHaveBeenCalled(); expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it("resolves normally and logs when the settle statement throws", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.execute.mockImplementation(async query => {
      if (dialect.sqlToQuery(query).sql.includes("insert into provider_budget_reservation")) return [{ day: "2026-10-07" }];
      throw Object.assign(new Error("settlement unavailable"), { name: "NeonDbError" });
    });
    await expect(runPaidCall(meta, async () => ({ value: "result", costUsd: 3 }))).resolves.toBe("result");
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ unitCostUsd: 3, ok: true }));
    expect(logged).toHaveBeenCalledWith("[paid] settle failed", expect.objectContaining({ provider: "gateway", error: "NeonDbError" }));
  });

  it("rethrows the provider error, not the settlement failure, when settle also throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.execute.mockImplementation(async query => {
      if (dialect.sqlToQuery(query).sql.includes("insert into provider_budget_reservation")) return [{ day: "2026-10-07" }];
      throw new Error("settlement unavailable");
    });
    const providerError = new Error("Unusable provider response");
    await expect(runPaidCall<string>(meta, async () => ({ error: providerError, costUsd: 0.25 }))).rejects.toBe(providerError);
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ unitCostUsd: 0.25, ok: false }));
  });

  it("lets two overlapping calls to the same provider both run when the budget fits", async () => {
    fakeReservations();
    const releaseFirst = deferred();
    const releaseSecond = deferred();
    const started: string[] = [];
    const first = runPaidCall(meta, async () => {
      started.push("first"); await releaseFirst.promise; return { value: "one", costUsd: 0.04 };
    });
    const second = runPaidCall(meta, async () => {
      started.push("second"); await releaseSecond.promise; return { value: "two", costUsd: 0.04 };
    });
    await vi.waitFor(() => expect(started).toEqual(["first", "second"]));
    releaseSecond.resolve();
    releaseFirst.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual(["one", "two"]);
  });

  it("does not let a held gateway call block a dataforseo call", async () => {
    fakeReservations();
    const release = deferred();
    let gatewayStarted = false;
    const gateway = runPaidCall(meta, async () => {
      gatewayStarted = true; await release.promise; return { value: "gateway", costUsd: 0.04 };
    });
    await vi.waitFor(() => expect(gatewayStarted).toBe(true));
    await expect(runPaidCall({ ...meta, provider: "dataforseo" }, async () => ({ value: "dataforseo", costUsd: 0.04 })))
      .resolves.toBe("dataforseo");
    release.resolve();
    await expect(gateway).resolves.toBe("gateway");
  });

  it("uses VANTAGE_PAID_DAILY_BUDGET_<PROVIDER>_USD for its provider and the global cap otherwise", async () => {
    vi.stubEnv("VANTAGE_PAID_DAILY_BUDGET_DATAFORSEO_USD", "1");
    vi.stubEnv("VANTAGE_PAID_DAILY_BUDGET_AI_GATEWAY_USD", "0.5");
    await runPaidCall({ ...meta, provider: "dataforseo" }, async () => ({ value: "a", costUsd: 0.04 }));
    await runPaidCall({ ...meta, provider: "ai_gateway" }, async () => ({ value: "b", costUsd: 0.04 }));
    await runPaidCall(meta, async () => ({ value: "c", costUsd: 0.04 }));
    const [dataforseo, aiGateway, gateway] = reserveQueries();
    expect(dataforseo.params).toEqual(expect.arrayContaining(["dataforseo", "1.000000"]));
    expect(aiGateway.params).toEqual(expect.arrayContaining(["ai_gateway", "0.500000"]));
    expect(gateway.params).toEqual(expect.arrayContaining(["gateway", "2.000000"]));
  });

  it.each(["0", "-1", "abc", ""])("falls back to the global cap when the provider cap is %j", async raw => {
    vi.stubEnv("VANTAGE_PAID_DAILY_BUDGET_DATAFORSEO_USD", raw);
    await runPaidCall({ ...meta, provider: "dataforseo" }, async () => ({ value: "a", costUsd: 0.04 }));
    expect(reserveQueries()[0].params).toEqual(expect.arrayContaining(["2.000000"]));
  });

  it("accepts a provider cap as the explicit budget when the global cap is unset", async () => {
    vi.stubEnv("VANTAGE_PAID_DAILY_BUDGET_USD", "");
    vi.stubEnv("VANTAGE_PAID_DAILY_BUDGET_DATAFORSEO_USD", "1");
    await expect(runPaidCall({ ...meta, provider: "dataforseo" }, async () => ({ value: "a", costUsd: 0.04 }))).resolves.toBe("a");
    const work = vi.fn();
    await expect(runPaidCall(meta, work)).rejects.toThrow(/budget/i);
    expect(work).not.toHaveBeenCalled();
  });

  it("enforces each provider cap on its own, without spending another provider's budget", async () => {
    vi.stubEnv("VANTAGE_PAID_DAILY_BUDGET_DATAFORSEO_USD", "0.15");
    fakeReservations();
    await expect(runPaidCall({ ...meta, provider: "dataforseo" }, async () => ({ value: "first", costUsd: 0.1 })))
      .resolves.toBe("first");
    const second = vi.fn();
    await expect(runPaidCall({ ...meta, provider: "dataforseo" }, second)).rejects.toBeInstanceOf(PaidCallDeniedError);
    expect(second).not.toHaveBeenCalled();
    await expect(runPaidCall(meta, async () => ({ value: "gateway", costUsd: 0.1 }))).resolves.toBe("gateway");
  });
});
