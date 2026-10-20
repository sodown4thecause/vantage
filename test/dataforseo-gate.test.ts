import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({
  consume: vi.fn(),
  release: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  execute: vi.fn(),
  runPaidCall: vi.fn(),
  meta: undefined as unknown,
  settled: undefined as unknown,
  recordCost: vi.fn(),
}));

vi.mock("@/lib/plans/limits", () => ({ consume: mocks.consume, release: mocks.release }));
vi.mock("@/lib/providers/paid-call", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/providers/paid-call")>(),
  runPaidCall: mocks.runPaidCall,
}));
vi.mock("@/lib/costs/ledger", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/costs/ledger")>(),
  recordCost: mocks.recordCost,
}));
vi.mock("@/lib/dataforseo/cache", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/dataforseo/cache")>(),
  readDataForSeoCache: mocks.read,
  writeDataForSeoCache: mocks.write,
}));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({ execute: mocks.execute }) }));

import { DataForSeoApiError } from "@/lib/dataforseo/client";
import { dataForSeoCacheKey } from "@/lib/dataforseo/cache";
import {
  DataForSeoDeniedError,
  type GateRequest,
  listLlmModels,
  peekDataForSeo,
  resetBalanceCacheForTests,
  resetLlmModelsCacheForTests,
  runDataForSeo,
} from "@/lib/dataforseo/gate";
import { PaidCallDeniedError } from "@/lib/providers/paid-call";

const CREDIT = "seo_credits_per_month";
const ENDPOINT = "/v3/backlinks/summary/live";
const TASK = { target: "example.com" };
const FRESHNESS = 604_800;
const ESTIMATE = 0.05;
const now = new Date("2026-10-19T12:00:00.000Z");
const MINUTE = 60_000;

const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
const error = vi.spyOn(console, "error").mockImplementation(() => {});

type Row = { rank: number; internal: string };
type Trimmed = { rank: number };
const trim = (rows: Row[]): Trimmed[] => rows.map(({ rank }) => ({ rank }));
const request = (overrides: Partial<GateRequest<Row, Trimmed[]>> = {}): GateRequest<Row, Trimmed[]> => ({
  workspaceId: "ws-1",
  endpoint: ENDPOINT,
  task: TASK,
  freshnessSeconds: FRESHNESS,
  estimateUsd: ESTIMATE,
  trim,
  ...overrides,
});
const run = (overrides?: Partial<GateRequest<Row, Trimmed[]>>, opts: { signal?: AbortSignal; fetchImpl?: typeof fetch; now?: Date } = {}) =>
  runDataForSeo<Row, Trimmed[]>(request(overrides), { now, ...opts });

function configure(mode: "live" | "sandbox" | "unconfigured") {
  vi.stubEnv("DATAFORSEO_USERNAME", "");
  vi.stubEnv("DATAFORSEO_LOGIN", mode === "unconfigured" ? "" : "gate-user");
  vi.stubEnv("DATAFORSEO_PASSWORD", mode === "unconfigured" ? "" : "gate-password");
  vi.stubEnv("DATAFORSEO_ENV", mode === "live" ? "live" : "");
  vi.stubEnv("DATAFORSEO_DAILY_BUDGET_USD", "5");
  vi.stubEnv("DATAFORSEO_RESERVE_FLOOR_USD", "");
  vi.stubEnv("DATAFORSEO_ALERT_BALANCE_USD", "");
}

const balanceBody = (balance: number) =>
  JSON.stringify({ status_code: 20000, tasks: [{ status_code: 20000, result: [{ money: { balance } }] }] });
const postBody = (result: unknown[], cost = 0.02, taskStatus = 20000) =>
  JSON.stringify({ status_code: 20000, cost, tasks: [{ status_code: taskStatus, cost, result }] });

type FetchOptions = { balance?: number; post?: () => Response };
function makeFetch({ balance = 100, post = () => new Response(postBody([{ rank: 1, internal: "row" }])) }: FetchOptions = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("/v3/appendix/user_data")) return new Response(balanceBody(balance), { status: 200 });
    return post();
  });
}
type FetchMock = ReturnType<typeof makeFetch>;
const asFetch = (fetchImpl: FetchMock) => fetchImpl as unknown as typeof fetch;
const callsTo = (fetchImpl: FetchMock, fragment: string) =>
  fetchImpl.mock.calls.filter(([input]) => String(input).includes(fragment));

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected the promise to reject");
}

describe("DataForSEO spend gate", () => {
  beforeEach(() => {
    resetBalanceCacheForTests();
    warn.mockClear();
    error.mockClear();
    mocks.consume.mockReset().mockResolvedValue({ allowed: true, limit: 10, used: 1, remaining: 9, consumed: 1 });
    mocks.release.mockReset().mockResolvedValue(undefined);
    mocks.read.mockReset().mockResolvedValue(null);
    mocks.write.mockReset().mockResolvedValue(undefined);
    mocks.execute.mockReset().mockResolvedValue([{ total: "0" }]);
    mocks.meta = undefined;
    mocks.settled = undefined;
    mocks.runPaidCall.mockReset().mockImplementation(async (meta: unknown, work: () => Promise<{ value?: unknown; error?: Error; costUsd?: number }>) => {
      mocks.meta = meta;
      const settled = await work();
      mocks.settled = settled;
      if (settled.error) throw settled.error;
      return settled.value;
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  describe("runDataForSeo", () => {
    it("denies as not_configured before any cache read, credit or fetch", async () => {
      configure("unconfigured");
      const fetchImpl = makeFetch();
      await expect(run({}, { fetchImpl: asFetch(fetchImpl) })).rejects.toMatchObject({ name: "DataForSeoDeniedError", code: "not_configured" });
      expect(mocks.read).not.toHaveBeenCalled();
      expect(mocks.consume).not.toHaveBeenCalled();
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("reads the cache with the request's freshnessSeconds", async () => {
      configure("live");
      mocks.read.mockResolvedValue([{ rank: 7 }]);
      await run({ freshnessSeconds: 2_592_000 });
      expect(mocks.read).toHaveBeenCalledExactlyOnceWith(dataForSeoCacheKey("live", ENDPOINT, TASK), 2_592_000, now);
    });

    it("returns a cache hit with no credit, no release and no fetch", async () => {
      configure("live");
      mocks.read.mockResolvedValue([{ rank: 7 }]);
      const fetchImpl = makeFetch();
      await expect(run({}, { fetchImpl: asFetch(fetchImpl) })).resolves.toEqual({ value: [{ rank: 7 }], cached: true });
      expect(mocks.consume).not.toHaveBeenCalled();
      expect(mocks.runPaidCall).not.toHaveBeenCalled();
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(mocks.release).not.toHaveBeenCalled();
    });

    it("denies as credits_exhausted when the monthly credit is refused, without releasing or fetching", async () => {
      configure("live");
      mocks.consume.mockResolvedValue({ allowed: false, limit: 10, used: 10, remaining: 0, consumed: 0 });
      const fetchImpl = makeFetch();
      await expect(run({}, { fetchImpl: asFetch(fetchImpl) })).rejects.toMatchObject({ code: "credits_exhausted" });
      expect(mocks.consume).toHaveBeenCalledWith("ws-1", CREDIT, 1, now);
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(mocks.release).not.toHaveBeenCalled();
    });

    it("charges the request's credit weight and releases the same weight on a failure", async () => {
      configure("live");
      const fetchImpl = makeFetch({ balance: 10 });
      await expect(run({ credits: 2 }, { fetchImpl: asFetch(fetchImpl) })).rejects.toMatchObject({ code: "reserve_floor" });
      expect(mocks.consume).toHaveBeenCalledExactlyOnceWith("ws-1", CREDIT, 2, now);
      expect(mocks.release).toHaveBeenCalledExactlyOnceWith("ws-1", CREDIT, 2, now);
    });

    it("keeps a two-credit call's charge on success and does not release it", async () => {
      configure("live");
      const fetchImpl = makeFetch({ balance: 100 });
      await expect(run({ credits: 2 }, { fetchImpl: asFetch(fetchImpl) })).resolves.toMatchObject({ cached: false });
      expect(mocks.consume).toHaveBeenCalledExactlyOnceWith("ws-1", CREDIT, 2, now);
      expect(mocks.release).not.toHaveBeenCalled();
    });

    it("refuses a two-credit call that does not fit the monthly credits, without fetching", async () => {
      configure("live");
      mocks.consume.mockResolvedValue({ allowed: false, limit: 10, used: 9, remaining: 1, consumed: 0 });
      const fetchImpl = makeFetch();
      await expect(run({ credits: 2 }, { fetchImpl: asFetch(fetchImpl) })).rejects.toMatchObject({ code: "credits_exhausted" });
      expect(mocks.consume).toHaveBeenCalledExactlyOnceWith("ws-1", CREDIT, 2, now);
      expect(mocks.release).not.toHaveBeenCalled();
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("charges one credit when the request names no weight", async () => {
      configure("live");
      const fetchImpl = makeFetch({ balance: 100 });
      await run({}, { fetchImpl: asFetch(fetchImpl) });
      expect(mocks.consume).toHaveBeenCalledExactlyOnceWith("ws-1", CREDIT, 1, now);
    });

    it("denies as reserve_floor below the floor, releases the credit once and never POSTs", async () => {
      configure("live");
      const fetchImpl = makeFetch({ balance: 10 });
      await expect(run({}, { fetchImpl: asFetch(fetchImpl) })).rejects.toMatchObject({ code: "reserve_floor" });
      expect(mocks.release).toHaveBeenCalledExactlyOnceWith("ws-1", CREDIT, 1, now);
      expect(callsTo(fetchImpl, "/v3/appendix/user_data")).toHaveLength(1);
      expect(callsTo(fetchImpl, "/v3/backlinks")).toHaveLength(0);
      expect(mocks.runPaidCall).not.toHaveBeenCalled();
    });

    it("denies as balance_unknown when the balance lookup fails, and releases the credit once", async () => {
      configure("live");
      const fetchImpl = makeFetch();
      fetchImpl.mockImplementationOnce(async () => new Response("unavailable", { status: 500 }));
      await expect(run({}, { fetchImpl: asFetch(fetchImpl) })).rejects.toMatchObject({ code: "balance_unknown" });
      expect(mocks.release).toHaveBeenCalledExactlyOnceWith("ws-1", CREDIT, 1, now);
      expect(callsTo(fetchImpl, "/v3/backlinks")).toHaveLength(0);
    });

    it("does not memoise a failed balance lookup", async () => {
      configure("live");
      const fetchImpl = makeFetch();
      fetchImpl.mockImplementationOnce(async () => new Response("unavailable", { status: 500 }));
      await expect(run({}, { fetchImpl: asFetch(fetchImpl) })).rejects.toMatchObject({ code: "balance_unknown" });
      await expect(run({}, { fetchImpl: asFetch(fetchImpl) })).resolves.toMatchObject({ cached: false });
      expect(callsTo(fetchImpl, "/v3/appendix/user_data")).toHaveLength(2);
    });

    it("warns below the alert threshold but still spends", async () => {
      configure("live");
      const fetchImpl = makeFetch({ balance: 25 });
      await expect(run({}, { fetchImpl: asFetch(fetchImpl) })).resolves.toMatchObject({ cached: false });
      expect(warn).toHaveBeenCalledExactlyOnceWith("[dataforseo] balance below alert threshold", { balance: 25 });
      expect(mocks.release).not.toHaveBeenCalled();
    });

    it("never looks up the balance in sandbox", async () => {
      configure("sandbox");
      const fetchImpl = makeFetch({ balance: 0 });
      await expect(run({}, { fetchImpl: asFetch(fetchImpl) })).resolves.toMatchObject({ cached: false });
      expect(callsTo(fetchImpl, "/v3/appendix/user_data")).toHaveLength(0);
      expect(callsTo(fetchImpl, "https://sandbox.dataforseo.com/v3/backlinks/summary/live")).toHaveLength(1);
    });

    it("memoises the balance for 5 minutes, then looks it up again", async () => {
      configure("live");
      const fetchImpl = makeFetch({ balance: 100 });
      await run({}, { fetchImpl: asFetch(fetchImpl) });
      await run({}, { fetchImpl: asFetch(fetchImpl), now: new Date(now.getTime() + 4 * MINUTE) });
      expect(callsTo(fetchImpl, "/v3/appendix/user_data")).toHaveLength(1);
      await run({}, { fetchImpl: asFetch(fetchImpl), now: new Date(now.getTime() + 6 * MINUTE) });
      expect(callsTo(fetchImpl, "/v3/appendix/user_data")).toHaveLength(2);
    });

    it("denies as daily_cap when today's spend plus the estimate exceeds the cap", async () => {
      configure("live");
      mocks.execute.mockResolvedValue([{ total: "4.99" }]);
      const fetchImpl = makeFetch();
      await expect(run({}, { fetchImpl: asFetch(fetchImpl) })).rejects.toMatchObject({ code: "daily_cap" });
      expect(mocks.release).toHaveBeenCalledExactlyOnceWith("ws-1", CREDIT, 1, now);
      expect(callsTo(fetchImpl, "/v3/backlinks")).toHaveLength(0);
    });

    it("allows a call that lands exactly on the daily cap", async () => {
      configure("live");
      mocks.execute.mockResolvedValue([{ total: "4.95" }]);
      await expect(run({}, { fetchImpl: asFetch(makeFetch()) })).resolves.toMatchObject({ cached: false });
    });

    it("sums spend from UTC midnight for the DataForSEO provider only", async () => {
      configure("live");
      await run({}, { fetchImpl: asFetch(makeFetch()) });
      const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0]);
      expect(query.sql).toContain("provider = 'dataforseo'");
      expect(query.sql).toContain("::timestamptz");
      expect(query.params).toContain("2026-10-19T00:00:00.000Z");
      expect(query.sql).not.toContain("2026-10-19");
    });

    it("denies as daily_cap when the spend query fails or returns no total", async () => {
      configure("live");
      mocks.execute.mockRejectedValueOnce(new Error("database down"));
      await expect(run({}, { fetchImpl: asFetch(makeFetch()) })).rejects.toMatchObject({ code: "daily_cap" });
      mocks.execute.mockResolvedValueOnce([]);
      await expect(run({}, { fetchImpl: asFetch(makeFetch()) })).rejects.toMatchObject({ code: "daily_cap" });
      expect(mocks.release).toHaveBeenCalledTimes(2);
    });

    it("keeps denial messages free of balances and credentials", async () => {
      configure("live");
      const err = await captureError(run({}, { fetchImpl: asFetch(makeFetch({ balance: 10 })) }));
      expect(err).toBeInstanceOf(DataForSeoDeniedError);
      expect((err as Error).message).not.toMatch(/\d|gate-password|gate-user/);
    });

    it("runs the paid call with workspace attribution and the estimate, then caches the trimmed value", async () => {
      configure("live");
      const signal = new AbortController().signal;
      const fetchImpl = makeFetch({ balance: 100 });
      await expect(run({}, { fetchImpl: asFetch(fetchImpl), signal })).resolves.toEqual({ value: [{ rank: 1 }], cached: false });
      expect(mocks.meta).toEqual(expect.objectContaining({
        context: { workspaceId: "ws-1", sourceKey: "seo" },
        provider: "dataforseo",
        action: ENDPOINT,
        estimateUsd: ESTIMATE,
        signal,
      }));
      expect(mocks.settled).toEqual({ value: [{ rank: 1 }], costUsd: 0.02 });
      expect(mocks.write).toHaveBeenCalledExactlyOnceWith(
        dataForSeoCacheKey("live", ENDPOINT, TASK),
        ENDPOINT,
        [{ rank: 1 }],
      );
      expect(mocks.release).not.toHaveBeenCalled();
    });

    it("keeps the paid result and does not release when the cache write fails", async () => {
      configure("live");
      mocks.write.mockRejectedValueOnce(new Error("write down"));
      await expect(run({}, { fetchImpl: asFetch(makeFetch({ balance: 100 })) })).resolves.toEqual({ value: [{ rank: 1 }], cached: false });
      expect(mocks.release).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalled();
    });

    it("rejects a task-level failure, releases once and does not cache", async () => {
      configure("live");
      const fetchImpl = makeFetch({
        balance: 100,
        post: () => new Response(postBody([], 0.01, 40501)),
      });
      const err = await captureError(run({}, { fetchImpl: asFetch(fetchImpl) }));
      expect(err).toBeInstanceOf(DataForSeoApiError);
      expect(err).toMatchObject({ statusCode: 40501 });
      expect(mocks.settled).toEqual({ error: err, costUsd: 0.01 });
      expect(mocks.release).toHaveBeenCalledExactlyOnceWith("ws-1", CREDIT, 1, now);
      expect(mocks.write).not.toHaveBeenCalled();
    });

    it("passes an unreadable HTTP failure cost through as undefined so the estimate is charged", async () => {
      configure("live");
      const fetchImpl = makeFetch({ balance: 100, post: () => new Response("server error", { status: 500 }) });
      const err = await captureError(run({}, { fetchImpl: asFetch(fetchImpl) }));
      expect(err).toMatchObject({ statusCode: 500 });
      expect((mocks.settled as { costUsd?: number }).costUsd).toBeUndefined();
      expect(mocks.release).toHaveBeenCalledExactlyOnceWith("ws-1", CREDIT, 1, now);
      expect(mocks.write).not.toHaveBeenCalled();
    });

    it("releases once and rethrows a non-API failure from the transport", async () => {
      configure("live");
      const fetchImpl = makeFetch({ balance: 100 });
      fetchImpl.mockImplementation(async (input: RequestInfo | URL) => {
        if (String(input).includes("/v3/appendix/user_data")) return new Response(balanceBody(100), { status: 200 });
        throw new TypeError("socket hang up");
      });
      await expect(run({}, { fetchImpl: asFetch(fetchImpl) })).rejects.toThrow("socket hang up");
      expect(mocks.release).toHaveBeenCalledExactlyOnceWith("ws-1", CREDIT, 1, now);
      expect(mocks.write).not.toHaveBeenCalled();
    });

    it("releases once and rethrows when runPaidCall denies the call", async () => {
      configure("live");
      mocks.runPaidCall.mockRejectedValueOnce(new PaidCallDeniedError("budget_exhausted", "Daily provider budget exhausted or another reservation needs reconciliation."));
      const fetchImpl = makeFetch({ balance: 100 });
      await expect(run({}, { fetchImpl: asFetch(fetchImpl) })).rejects.toBeInstanceOf(PaidCallDeniedError);
      expect(mocks.release).toHaveBeenCalledExactlyOnceWith("ws-1", CREDIT, 1, now);
      expect(callsTo(fetchImpl, "/v3/backlinks")).toHaveLength(0);
      expect(mocks.write).not.toHaveBeenCalled();
    });
  });

  describe("sandbox in production", () => {
    beforeEach(() => {
      vi.stubEnv("NODE_ENV", "production");
    });

    it("denies a sandbox call as not_configured before any cache read, credit or fetch without ALLOW_FIXTURES", async () => {
      configure("sandbox");
      const fetchImpl = makeFetch();
      await expect(run({}, { fetchImpl: asFetch(fetchImpl) })).rejects.toMatchObject({ name: "DataForSeoDeniedError", code: "not_configured" });
      expect(mocks.read).not.toHaveBeenCalled();
      expect(mocks.consume).not.toHaveBeenCalled();
      expect(mocks.release).not.toHaveBeenCalled();
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("runs the sandbox call when ALLOW_FIXTURES is true", async () => {
      configure("sandbox");
      vi.stubEnv("ALLOW_FIXTURES", "true");
      const fetchImpl = makeFetch();
      await expect(run({}, { fetchImpl: asFetch(fetchImpl) })).resolves.toMatchObject({ cached: false });
      expect(mocks.consume).toHaveBeenCalledExactlyOnceWith("ws-1", CREDIT, 1, now);
      expect(callsTo(fetchImpl, "https://sandbox.dataforseo.com/v3/backlinks/summary/live")).toHaveLength(1);
    });

    it("leaves live calls unaffected by ALLOW_FIXTURES being unset", async () => {
      configure("live");
      const fetchImpl = makeFetch({ balance: 100 });
      await expect(run({}, { fetchImpl: asFetch(fetchImpl) })).resolves.toMatchObject({ cached: false });
      expect(callsTo(fetchImpl, "https://api.dataforseo.com/v3/backlinks/summary/live")).toHaveLength(1);
    });

    it("peek returns null without reading the cache for a sandbox call without ALLOW_FIXTURES", async () => {
      configure("sandbox");
      mocks.read.mockResolvedValue([{ rank: 3 }]);
      await expect(peekDataForSeo(ENDPOINT, TASK, FRESHNESS)).resolves.toBeNull();
      expect(mocks.read).not.toHaveBeenCalled();
    });
  });

  describe("peekDataForSeo", () => {
    it("returns the cached value without consuming, querying the database or fetching", async () => {
      configure("live");
      mocks.read.mockResolvedValue([{ rank: 3 }]);
      await expect(peekDataForSeo(ENDPOINT, TASK, FRESHNESS)).resolves.toEqual([{ rank: 3 }]);
      expect(mocks.read).toHaveBeenCalledWith(dataForSeoCacheKey("live", ENDPOINT, TASK), FRESHNESS);
      expect(mocks.consume).not.toHaveBeenCalled();
      expect(mocks.execute).not.toHaveBeenCalled();
      expect(mocks.release).not.toHaveBeenCalled();
    });

    it("uses the freshness window it is given", async () => {
      configure("live");
      mocks.read.mockResolvedValue([{ rank: 3 }]);
      await peekDataForSeo(ENDPOINT, TASK, 2_592_000);
      expect(mocks.read).toHaveBeenCalledWith(dataForSeoCacheKey("live", ENDPOINT, TASK), 2_592_000);
    });

    it("returns null on a cache miss", async () => {
      configure("live");
      await expect(peekDataForSeo(ENDPOINT, TASK, FRESHNESS)).resolves.toBeNull();
    });

    it("returns null without reading the cache when unconfigured", async () => {
      configure("unconfigured");
      await expect(peekDataForSeo(ENDPOINT, TASK, FRESHNESS)).resolves.toBeNull();
      expect(mocks.read).not.toHaveBeenCalled();
    });
  });
});

describe("listLlmModels", () => {
  const modelsPath = "https://api.dataforseo.com/v3/ai_optimization/chat_gpt/llm_responses/models";
  const modelsBody = (result: unknown[], cost = 0) =>
    JSON.stringify({ status_code: 20000, cost, tasks: [{ status_code: 20000, cost, result }] });
  const modelsFetch = (body: () => Response = () => new Response(modelsBody([{ model_name: "gpt-4o", web_search_supported: true }]))) =>
    vi.fn(async () => body());
  const DAY = 24 * 60 * MINUTE;

  beforeEach(() => {
    resetLlmModelsCacheForTests();
    mocks.recordCost.mockReset().mockResolvedValue(true);
    error.mockClear();
  });

  it("returns an empty list without any request when DataForSEO is unconfigured", async () => {
    configure("unconfigured");
    const fetchImpl = modelsFetch();
    await expect(listLlmModels("chat_gpt", { fetchImpl: asFetch(fetchImpl) })).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("GETs the models endpoint once for two calls and trims each model to name and web search", async () => {
    configure("live");
    const fetchImpl = modelsFetch(() => new Response(modelsBody([
      { model_name: "gpt-4o", web_search_supported: true, extra: "ignored" },
      { model_name: "gpt-mini", web_search_supported: "yes" },
      { web_search_supported: true },
    ])));
    const first = await listLlmModels("chat_gpt", { fetchImpl: asFetch(fetchImpl), now });
    const second = await listLlmModels("chat_gpt", { fetchImpl: asFetch(fetchImpl), now: new Date(now.getTime() + MINUTE) });

    const expected = [
      { modelName: "gpt-4o", webSearch: true },
      { modelName: "gpt-mini", webSearch: false },
    ];
    expect(first).toEqual(expected);
    expect(second).toEqual(expected);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(modelsPath);
    expect(init.method).toBe("GET");
  });

  it("memoises per engine, so another engine is fetched separately", async () => {
    configure("live");
    const fetchImpl = modelsFetch();
    await listLlmModels("chat_gpt", { fetchImpl: asFetch(fetchImpl), now });
    await listLlmModels("claude", { fetchImpl: asFetch(fetchImpl), now });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String((fetchImpl.mock.calls[1] as unknown as [string])[0])).toContain("/v3/ai_optimization/claude/llm_responses/models");
  });

  it("looks the models up again after 24 hours", async () => {
    configure("live");
    const fetchImpl = modelsFetch();
    await listLlmModels("chat_gpt", { fetchImpl: asFetch(fetchImpl), now });
    await listLlmModels("chat_gpt", { fetchImpl: asFetch(fetchImpl), now: new Date(now.getTime() + DAY - MINUTE) });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await listLlmModels("chat_gpt", { fetchImpl: asFetch(fetchImpl), now: new Date(now.getTime() + DAY + MINUTE) });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns an empty list on an upstream error, logs without the body, and does not memoise the failure", async () => {
    configure("live");
    const fetchImpl = modelsFetch(() => new Response("upstream secret-body", { status: 500 }));
    await expect(listLlmModels("chat_gpt", { fetchImpl: asFetch(fetchImpl), now })).resolves.toEqual([]);
    expect(error).toHaveBeenCalled();
    expect(JSON.stringify(error.mock.calls)).not.toContain("secret-body");

    fetchImpl.mockImplementation(async () => new Response(modelsBody([{ model_name: "gpt-4o", web_search_supported: true }])));
    await expect(listLlmModels("chat_gpt", { fetchImpl: asFetch(fetchImpl), now })).resolves.toEqual([
      { modelName: "gpt-4o", webSearch: true },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not memoise an empty successful list, so a transient empty answer heals on the next call", async () => {
    configure("live");
    const fetchImpl = modelsFetch(() => new Response(modelsBody([])));
    await expect(listLlmModels("chat_gpt", { fetchImpl: asFetch(fetchImpl), now })).resolves.toEqual([]);
    await expect(listLlmModels("chat_gpt", { fetchImpl: asFetch(fetchImpl), now })).resolves.toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("records a non-zero cost under dataforseo and the llm_models action with the seo source", async () => {
    configure("live");
    const fetchImpl = modelsFetch(() => new Response(modelsBody([{ model_name: "m", web_search_supported: false }], 0.002)));
    await listLlmModels("chat_gpt", { fetchImpl: asFetch(fetchImpl), now });
    expect(mocks.recordCost).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      sourceKey: "seo",
      provider: "dataforseo",
      action: "llm_models",
      unitCostUsd: 0.002,
    }));
  });

  it("records no cost for a zero-cost models call", async () => {
    configure("live");
    await listLlmModels("chat_gpt", { fetchImpl: asFetch(modelsFetch()), now });
    expect(mocks.recordCost).not.toHaveBeenCalled();
  });

  it("records a cost that the provider reports on a failed call", async () => {
    configure("live");
    const fetchImpl = modelsFetch(() => new Response(JSON.stringify({ status_code: 40501, cost: 0.003, tasks: [] }), { status: 200 }));
    await expect(listLlmModels("chat_gpt", { fetchImpl: asFetch(fetchImpl), now })).resolves.toEqual([]);
    expect(mocks.recordCost).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ provider: "dataforseo", action: "llm_models", unitCostUsd: 0.003 }));
  });
});
