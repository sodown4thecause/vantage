import { describe, expect, it, vi } from "vitest";

import { dataForSeoAvailable, dataForSeoConfig } from "@/lib/dataforseo/config";
import { DataForSeoApiError, dataForSeoPost, getDataForSeoBalance } from "@/lib/dataforseo/client";

const LOGIN = "login-secret-user";
const PASSWORD = "pw-secret-value";
const config = dataForSeoConfig({ DATAFORSEO_LOGIN: LOGIN, DATAFORSEO_PASSWORD: PASSWORD })!;

const stubFetch = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })) as unknown as
    ReturnType<typeof vi.fn> & typeof fetch;

const envelope = (task: Record<string, unknown>, top: Record<string, unknown> = {}) => ({
  version: "0.1.20241014",
  status_code: 20000,
  status_message: "Ok.",
  time: "0.1 sec.",
  cost: task.cost ?? 0,
  tasks_count: 1,
  tasks_error: 0,
  tasks: [{ id: "task-1", status_code: 20000, status_message: "Ok.", time: "0.1 sec.", cost: 0, result_count: 1, path: [], data: {}, result: [], ...task }],
  ...top,
});

describe("dataForSeoConfig", () => {
  it("is null until both credentials are present", () => {
    expect(dataForSeoConfig({})).toBeNull();
    expect(dataForSeoConfig({ DATAFORSEO_LOGIN: "  ", DATAFORSEO_PASSWORD: "p" })).toBeNull();
    expect(dataForSeoConfig({ DATAFORSEO_LOGIN: "u" })).toBeNull();
  });

  it("accepts DATAFORSEO_USERNAME as an alias for the login", () => {
    expect(dataForSeoConfig({ DATAFORSEO_USERNAME: "alias-user", DATAFORSEO_PASSWORD: "p" })).toMatchObject({ login: "alias-user" });
  });

  it("prefers DATAFORSEO_LOGIN when both login names are set", () => {
    expect(dataForSeoConfig({ DATAFORSEO_LOGIN: "login-user", DATAFORSEO_USERNAME: "alias-user", DATAFORSEO_PASSWORD: "p" })).toMatchObject({ login: "login-user" });
  });

  it("falls back to DATAFORSEO_USERNAME when DATAFORSEO_LOGIN is blank", () => {
    expect(dataForSeoConfig({ DATAFORSEO_LOGIN: "  ", DATAFORSEO_USERNAME: "alias-user", DATAFORSEO_PASSWORD: "p" })).toMatchObject({ login: "alias-user" });
  });

  it("is null when only DATAFORSEO_USERNAME is set without a password", () => {
    expect(dataForSeoConfig({ DATAFORSEO_USERNAME: "alias-user" })).toBeNull();
  });

  it("defaults to sandbox with the documented USD settings", () => {
    expect(dataForSeoConfig({ DATAFORSEO_LOGIN: "u", DATAFORSEO_PASSWORD: "p" })).toEqual({
      env: "sandbox",
      baseUrl: "https://sandbox.dataforseo.com",
      login: "u",
      password: "p",
      dailyBudgetUsd: 5,
      reserveFloorUsd: 15,
      alertBalanceUsd: 30,
    });
  });

  it("uses the live endpoint only when DATAFORSEO_ENV is exactly live", () => {
    const base = { DATAFORSEO_LOGIN: "u", DATAFORSEO_PASSWORD: "p" };
    expect(dataForSeoConfig({ ...base, DATAFORSEO_ENV: "live" })).toMatchObject({ env: "live", baseUrl: "https://api.dataforseo.com" });
    expect(dataForSeoConfig({ ...base, DATAFORSEO_ENV: "LIVE" })).toMatchObject({ env: "sandbox" });
  });

  it("falls back to defaults for non-numeric or negative settings", () => {
    const base = { DATAFORSEO_LOGIN: "u", DATAFORSEO_PASSWORD: "p" };
    expect(dataForSeoConfig({ ...base, DATAFORSEO_DAILY_BUDGET_USD: "abc" })?.dailyBudgetUsd).toBe(5);
    expect(dataForSeoConfig({ ...base, DATAFORSEO_RESERVE_FLOOR_USD: "-1" })?.reserveFloorUsd).toBe(15);
    expect(dataForSeoConfig({ ...base, DATAFORSEO_ALERT_BALANCE_USD: "" })?.alertBalanceUsd).toBe(30);
    expect(dataForSeoConfig({ ...base, DATAFORSEO_DAILY_BUDGET_USD: "2.5" })?.dailyBudgetUsd).toBe(2.5);
  });
});

describe("dataForSeoAvailable", () => {
  const creds = { DATAFORSEO_LOGIN: "u", DATAFORSEO_PASSWORD: "p" };

  it("is false when unconfigured", () => {
    expect(dataForSeoAvailable({ NODE_ENV: "development" })).toBe(false);
  });

  it("is true for sandbox outside production", () => {
    expect(dataForSeoAvailable({ ...creds, NODE_ENV: "development" })).toBe(true);
  });

  it("is false for sandbox in production unless ALLOW_FIXTURES is true", () => {
    expect(dataForSeoAvailable({ ...creds, NODE_ENV: "production" })).toBe(false);
    expect(dataForSeoAvailable({ ...creds, NODE_ENV: "production", ALLOW_FIXTURES: "yes" })).toBe(false);
    expect(dataForSeoAvailable({ ...creds, NODE_ENV: "production", ALLOW_FIXTURES: "true" })).toBe(true);
  });

  it("is true for live in production regardless of ALLOW_FIXTURES", () => {
    expect(dataForSeoAvailable({ ...creds, NODE_ENV: "production", DATAFORSEO_ENV: "live" })).toBe(true);
  });
});

describe("dataForSeoPost", () => {
  it("posts the task as a one-element array with Basic auth and returns result and task cost", async () => {
    const fetchImpl = stubFetch(envelope({ cost: 0.02, result: [{ keyword: "crm" }] }));
    const out = await dataForSeoPost<{ keyword: string }>(
      { ...config, login: "u", password: "p" },
      "/v3/backlinks/summary/live",
      { target: "example.com" },
      { fetchImpl },
    );

    expect(out).toEqual({ result: [{ keyword: "crm" }], costUsd: 0.02 });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://sandbox.dataforseo.com/v3/backlinks/summary/live");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ Authorization: `Basic ${btoa("u:p")}`, "Content-Type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual([{ target: "example.com" }]);
  });

  it("returns the task cost on success and undefined when no success cost is readable", async () => {
    const fetchImpl = stubFetch({ status_code: 20000, tasks: [{ status_code: 20000, result: [] }] });
    await expect(dataForSeoPost(config, "/v3/x", {}, { fetchImpl })).resolves.toEqual({ result: [], costUsd: undefined });
  });

  it("falls back to the top-level cost when the success task has none", async () => {
    const fetchImpl = stubFetch({ status_code: 20000, cost: 0.03, tasks: [{ status_code: 20000, result: [{ rank: 1 }] }] });
    await expect(dataForSeoPost(config, "/v3/x", {}, { fetchImpl })).resolves.toEqual({ result: [{ rank: 1 }], costUsd: 0.03 });
  });

  it("rejects HTTP errors with the status code, no cost and no body echo", async () => {
    const fetchImpl = stubFetch("upstream exploded with secret-body", 500);
    const error = await dataForSeoPost(config, "/v3/serp/x", {}, { fetchImpl }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DataForSeoApiError);
    expect(error).toMatchObject({ statusCode: 500 });
    expect((error as DataForSeoApiError).costUsd).toBeUndefined();
    expect((error as Error).message).not.toContain("secret-body");
  });

  it("reports the top-level cost on a failed envelope and leaves it undefined when absent", async () => {
    const withCost = stubFetch({ status_code: 40100, status_message: "bad", cost: 0.01, tasks: [] });
    const withCostError = await dataForSeoPost(config, "/v3/x", {}, { fetchImpl: withCost }).catch((e: unknown) => e);
    expect(withCostError).toMatchObject({ statusCode: 40100, costUsd: 0.01 });

    const noCost = stubFetch({ status_code: 40100, status_message: "bad", tasks: [] });
    const noCostError = await dataForSeoPost(config, "/v3/x", {}, { fetchImpl: noCost }).catch((e: unknown) => e);
    expect(noCostError).toMatchObject({ statusCode: 40100 });
    expect((noCostError as DataForSeoApiError).costUsd).toBeUndefined();
  });

  it("leaves the cost undefined for a task error with no cost anywhere", async () => {
    const fetchImpl = stubFetch({ status_code: 20000, tasks: [{ status_code: 40501, status_message: "Invalid Field." }] });
    const error = await dataForSeoPost(config, "/v3/x", {}, { fetchImpl }).catch((e: unknown) => e);
    expect(error).toMatchObject({ statusCode: 40501 });
    expect((error as DataForSeoApiError).costUsd).toBeUndefined();
  });

  it("treats a missing status_code as an invalid response", async () => {
    const fetchImpl = stubFetch({ tasks: [] });
    const error = await dataForSeoPost(config, "/v3/x", {}, { fetchImpl }).catch((e: unknown) => e);
    expect(error).toMatchObject({ statusCode: 0 });
    expect((error as DataForSeoApiError).costUsd).toBeUndefined();
  });

  it("rejects a top-level failure status even on HTTP 200", async () => {
    const fetchImpl = stubFetch({ status_code: 40100, status_message: "Authorization failed.", cost: 0, tasks: [] });
    await expect(dataForSeoPost(config, "/v3/serp/x", {}, { fetchImpl })).rejects.toMatchObject({ statusCode: 40100 });
  });

  it("rejects a task failure with the task status code and its cost", async () => {
    const fetchImpl = stubFetch(envelope({ status_code: 40501, status_message: "Invalid Field.", cost: 0.02 }));
    const error = await dataForSeoPost(config, "/v3/serp/x", {}, { fetchImpl }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DataForSeoApiError);
    expect(error).toMatchObject({ statusCode: 40501, costUsd: 0.02 });
  });

  it("rejects a non-JSON body as an invalid response with no cost", async () => {
    const fetchImpl = stubFetch("<html>gateway</html>", 200);
    const error = await dataForSeoPost(config, "/v3/serp/x", {}, { fetchImpl }).catch((e: unknown) => e);
    expect(error).toMatchObject({ statusCode: 0 });
    expect((error as DataForSeoApiError).costUsd).toBeUndefined();
  });

  it("refuses paths outside /v3/ before fetching", async () => {
    const fetchImpl = stubFetch(envelope({}));
    await expect(dataForSeoPost(config, "/v2/serp/x", {}, { fetchImpl })).rejects.toThrow(/\/v3\//);
    await expect(dataForSeoPost(config, "https://evil.example/v3/x", {}, { fetchImpl })).rejects.toThrow(/\/v3\//);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never puts the login or password in an error message", async () => {
    const failures = [
      stubFetch("nope", 401),
      stubFetch({ status_code: 40100, status_message: "bad", cost: 0, tasks: [] }),
      stubFetch(envelope({ status_code: 40501 })),
      stubFetch("not json", 200),
    ];
    for (const fetchImpl of failures) {
      const error = await dataForSeoPost(config, "/v3/x", {}, { fetchImpl }).catch((e: unknown) => e) as Error;
      expect(error).toBeInstanceOf(Error);
      expect(error.message).not.toContain(LOGIN);
      expect(error.message).not.toContain(PASSWORD);
    }
  });
});

describe("getDataForSeoBalance", () => {
  const balanceEnvelope = (money: unknown) => envelope({ result: [{ money }] });

  it("reads tasks[0].result[0].money.balance from GET /v3/appendix/user_data", async () => {
    const fetchImpl = stubFetch(balanceEnvelope({ balance: 42.5 }));
    await expect(getDataForSeoBalance(config, { fetchImpl })).resolves.toBe(42.5);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://sandbox.dataforseo.com/v3/appendix/user_data");
    expect(init.method).toBe("GET");
  });

  it("rejects when the balance is missing", async () => {
    const fetchImpl = stubFetch(balanceEnvelope({}));
    await expect(getDataForSeoBalance(config, { fetchImpl })).rejects.toThrow(/balance/i);
  });
});
