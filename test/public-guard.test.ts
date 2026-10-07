import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  budget: new Map<string, { spent: number; cap: number }>(),
  visitors: new Map<string, number>(),
  statements: [] as string[],
  dbDown: false,
  limiter: null as null | { limit: (o: { key: string }) => Promise<{ success: boolean }> },
}));

// Emulates the two atomic upserts. Each execute() call is one indivisible
// statement, mirroring Postgres semantics for the guarded ON CONFLICT clauses.
vi.mock("@/lib/db/client", () => {
  const dialect = new PgDialect();
  return {
    getDb: () => ({
      execute: async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
        if (state.dbDown) throw new Error("connection string postgres://secret@host");
        const { sql: text, params } = dialect.sqlToQuery(query);
        state.statements.push(text);
        if (text.includes("into budget_day")) {
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
        if (text.includes("update budget_day")) {
          const row = state.budget.get(String(params[1]));
          if (row) row.spent = Math.max(0, row.spent + Number(params[0]));
          return { rows: [] };
        }
        if (text.includes("into public_visitor")) {
          const key = `${params[0]}|${params[1]}`;
          const limit = Number(params[2]);
          const n = state.visitors.get(key);
          if (n === undefined) {
            if (limit < 1) return { rows: [] };
            state.visitors.set(key, 1);
            return { rows: [{ scans: 1 }] };
          }
          if (n >= limit) return { rows: [] };
          state.visitors.set(key, n + 1);
          return { rows: [{ scans: n + 1 }] };
        }
        if (text.includes("update public_visitor")) {
          const key = `${params[0]}|${params[1]}`;
          const n = state.visitors.get(key);
          if (n !== undefined) state.visitors.set(key, Math.max(0, n - 1));
          return { rows: [] };
        }
        return { rows: [] };
      },
    }),
  };
});

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    if (!state.limiter) return { env: {} };
    return { env: { RADAR_LIMITER: state.limiter } };
  },
}));

import { refundPublicSpend, reservePublicBudget, settlePublicSpend } from "@/lib/public/budget";
import { guardPublicRequest, hashVisitor } from "@/lib/public/guard";

const opts = { action: "radar", costEstimateUsd: 1, perVisitorPerDay: 2 };
const req = (headers: Record<string, string> = {}) =>
  new Request("https://vantage.test/api/public/ping", {
    method: "POST",
    headers: { "cf-connecting-ip": "203.0.113.7", ...headers },
  });

const siteverify = (success: boolean) =>
  vi.fn(async () => new Response(JSON.stringify({ success }), { status: 200 }));

beforeEach(() => {
  state.budget.clear();
  state.visitors.clear();
  state.statements = [];
  state.dbDown = false;
  state.limiter = null;
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "");
  vi.stubEnv("TURNSTILE_DEV_BYPASS", "true");
  vi.stubEnv("VISITOR_SALT", "test-salt");
  vi.stubEnv("PUBLIC_DAILY_BUDGET_USD", "5");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("guardPublicRequest", () => {
  it("gives the visitor's allowance back when the shared budget rejects the request", async () => {
    vi.stubEnv("PUBLIC_DAILY_BUDGET_USD", "0.5");
    const res = await guardPublicRequest(req(), opts);
    expect(res).toEqual({ ok: false, status: 503, code: "budget_exhausted" });
    expect([...state.visitors.values()]).toEqual([0]);
  });

  it("allows a request and returns a hashed visitor, never the raw IP", async () => {
    const res = await guardPublicRequest(req(), opts);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.visitorHash).toMatch(/^[0-9a-f]{64}$/);
      expect(res.visitorHash).not.toContain("203.0.113.7");
    }
    for (const key of state.visitors.keys()) expect(key).not.toContain("203.0.113.7");
  });

  it("changes the visitor hash with the day salt", async () => {
    const a = await hashVisitor("1.2.3.4", "2026-10-06", "s");
    const b = await hashVisitor("1.2.3.4", "2026-10-07", "s");
    expect(a).not.toBe(b);
  });

  it("requires a Turnstile token when a secret is configured", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    const fetchMock = siteverify(true);
    vi.stubGlobal("fetch", fetchMock);
    expect(await guardPublicRequest(req(), opts)).toEqual({
      ok: false,
      status: 403,
      code: "turnstile_required",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid Turnstile token", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    const fetchMock = siteverify(false) as unknown as ReturnType<typeof vi.fn>;
    vi.stubGlobal("fetch", fetchMock);
    expect(await guardPublicRequest(req({ "x-turnstile-token": "bad" }), opts)).toEqual({
      ok: false,
      status: 403,
      code: "turnstile_failed",
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    );
  });

  it("accepts a valid Turnstile token", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    vi.stubGlobal("fetch", siteverify(true));
    expect((await guardPublicRequest(req({ "x-turnstile-token": "good" }), opts)).ok).toBe(true);
  });

  it("fails closed when siteverify is unreachable", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("net down"); }));
    expect(await guardPublicRequest(req({ "x-turnstile-token": "t" }), opts)).toEqual({
      ok: false,
      status: 503,
      code: "guard_unavailable",
    });
  });

  it("fails closed in production when Turnstile or the salt is not configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(await guardPublicRequest(req(), opts)).toEqual({
      ok: false,
      status: 503,
      code: "guard_unavailable",
    });
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    vi.stubEnv("VISITOR_SALT", "");
    expect((await guardPublicRequest(req({ "x-turnstile-token": "t" }), opts)).ok).toBe(false);
  });

  it("returns 429 when the optional rate-limit binding rejects", async () => {
    state.limiter = { limit: vi.fn(async () => ({ success: false })) };
    expect(await guardPublicRequest(req(), opts)).toEqual({
      ok: false,
      status: 429,
      code: "rate_limited",
    });
  });

  it("works without a rate-limit binding", async () => {
    expect((await guardPublicRequest(req(), opts)).ok).toBe(true);
  });

  it("enforces the per-visitor daily cap", async () => {
    expect((await guardPublicRequest(req(), opts)).ok).toBe(true);
    expect((await guardPublicRequest(req(), opts)).ok).toBe(true);
    expect(await guardPublicRequest(req(), opts)).toEqual({
      ok: false,
      status: 429,
      code: "visitor_limit",
    });
    // a different visitor is unaffected
    expect((await guardPublicRequest(req({ "cf-connecting-ip": "198.51.100.1" }), opts)).ok).toBe(true);
  });

  it("returns 503 budget_exhausted once the daily budget is spent", async () => {
    const big = { ...opts, costEstimateUsd: 3, perVisitorPerDay: 100 };
    expect((await guardPublicRequest(req(), big)).ok).toBe(true);
    expect(await guardPublicRequest(req(), big)).toEqual({
      ok: false,
      status: 503,
      code: "budget_exhausted",
    });
  });

  it("never overspends the cap under concurrent reservations", async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, () => reservePublicBudget(0.7, { day: "2026-10-06", capUsd: 5 })),
    );
    const granted = results.filter(Boolean).length;
    expect(granted).toBe(7);
    expect(state.budget.get("2026-10-06")!.spent).toBeLessThanOrEqual(5);
  });

  it("spends in a single guarded SQL statement", async () => {
    await reservePublicBudget(1, { day: "2026-10-06", capUsd: 5 });
    const budgetStatements = state.statements.filter((s) => s.includes("budget_day"));
    expect(budgetStatements).toHaveLength(1);
    expect(budgetStatements[0]).toMatch(/on conflict \(day\) do update[\s\S]*where budget_day\.spent_usd \+ .* <= excluded\.cap_usd/);
  });

  it("fails closed with a stable code and no internals when the database is down", async () => {
    state.dbDown = true;
    const res = await guardPublicRequest(req(), opts);
    expect(res).toEqual({ ok: false, status: 503, code: "guard_unavailable" });
    expect(JSON.stringify(res)).not.toContain("postgres");
  });

  it("returns a reservation handle pinned to the reserved day", async () => {
    const res = await guardPublicRequest(req(), opts);
    expect(res.ok && res.reservation).toEqual({
      day: new Date().toISOString().slice(0, 10),
      estimateUsd: 1,
    });
  });

  it("refunds a reservation when the scan fails", async () => {
    const res = await guardPublicRequest(req(), opts);
    if (!res.ok) throw new Error("expected ok");
    expect(state.budget.get(res.reservation.day)!.spent).toBe(1);
    await refundPublicSpend(res.reservation);
    expect(state.budget.get(res.reservation.day)!.spent).toBe(0);
  });

  it("settles against the reserved day even after UTC midnight", async () => {
    state.budget.set("2026-10-06", { spent: 1, cap: 5 });
    state.budget.set("2026-10-07", { spent: 2, cap: 5 });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-07T00:00:30Z"));
    await settlePublicSpend({ day: "2026-10-06", estimateUsd: 1 }, 0.25);
    vi.useRealTimers();
    expect(state.budget.get("2026-10-06")!.spent).toBeCloseTo(0.25);
    expect(state.budget.get("2026-10-07")!.spent).toBe(2);
  });

  it("rejects invalid estimates and visitor limits", async () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(await guardPublicRequest(req(), { ...opts, costEstimateUsd: bad })).toEqual({
        ok: false,
        status: 503,
        code: "guard_unavailable",
      });
    }
    await expect(reservePublicBudget(-1)).rejects.toThrow(RangeError);
    expect((await guardPublicRequest(req(), { ...opts, perVisitorPerDay: 0 })).ok).toBe(false);
  });

  it("fails closed without a Turnstile secret unless the dev bypass is set", async () => {
    vi.stubEnv("TURNSTILE_DEV_BYPASS", "");
    expect(await guardPublicRequest(req(), opts)).toEqual({
      ok: false,
      status: 503,
      code: "guard_unavailable",
    });
  });

  it("ignores the dev bypass in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await guardPublicRequest(req(), opts)).ok).toBe(false);
  });

  it("passes a timeout signal to siteverify", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    const fetchMock = siteverify(true) as unknown as ReturnType<typeof vi.fn>;
    vi.stubGlobal("fetch", fetchMock);
    await guardPublicRequest(req({ "x-turnstile-token": "t" }), opts);
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it("does not trust x-forwarded-for in production and rejects unidentified clients", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    vi.stubGlobal("fetch", siteverify(true));
    const headers = new Headers({ "x-forwarded-for": "9.9.9.9", "x-turnstile-token": "t" });
    const res = await guardPublicRequest(
      new Request("https://vantage.test/api/public/ping", { method: "POST", headers }),
      opts,
    );
    expect(res).toEqual({ ok: false, status: 400, code: "client_unidentified" });
  });
});
