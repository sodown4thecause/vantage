import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const state = vi.hoisted(() => ({
  /** plan_limit rows returned for any select from plan_limit. */
  limitRows: [] as Array<{ plan: string; key: string; value: number }>,
  /** workspace rows (plan lookups and owned-project counts). */
  workspaceRows: [] as Array<{ plan: string }>,
  usageValue: 0,
  executed: [] as Array<{ sql: string; params: unknown[] }>,
  /** Simulated counter used by the execute() mock to apply the WHERE guard. */
  counter: 0,
  limit: 20,
}));

vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    select: () => ({
      from: (table: unknown) => {
        const rows = () => {
          const name = (table as { [k: symbol]: unknown })[Symbol.for("drizzle:Name")];
          if (name === "plan_limit") return state.limitRows;
          if (name === "workspace") return state.workspaceRows;
          return [{ value: state.usageValue }];
        };
        const chain = Object.assign(Promise.resolve(rows()), {
          where: () => Object.assign(Promise.resolve(rows()), { limit: async () => rows() }),
        });
        return chain;
      },
    }),
    execute: async (query: { toQuery?: unknown }) => {
      const compiled = new PgDialect().sqlToQuery(query as never);
      state.executed.push({ sql: compiled.sql, params: compiled.params });
      const n = Number(compiled.params[2]);
      // Mirror the SQL guard: only apply when counter + n <= limit.
      if (state.counter + n <= state.limit) {
        state.counter += n;
        return { rows: [{ used: state.counter, limit: state.limit }] };
      }
      return { rows: [] };
    },
  }),
}));

import {
  assertCanCreateProject,
  assertWithinCount,
  checkCountLimit,
  consume,
  evaluateLimit,
  isScanDue,
  mergeLimits,
  usagePeriod,
} from "@/lib/plans/limits";
import { DEFAULT_LIMITS, LIMIT_KEYS, PlanLimitError } from "@/lib/plans/types";

beforeEach(() => {
  state.limitRows = [];
  state.workspaceRows = [{ plan: "free" }];
  state.usageValue = 0;
  state.executed = [];
  state.counter = 0;
  state.limit = 20;
});

describe("limit evaluation", () => {
  it("allows under the limit, at the limit boundary, and refuses over it", () => {
    expect(evaluateLimit(5, 4).allowed).toBe(true);
    expect(evaluateLimit(5, 5).allowed).toBe(false);
    expect(evaluateLimit(5, 6)).toMatchObject({ allowed: false, remaining: 0 });
    expect(checkCountLimit(5, 0, 5).allowed).toBe(true);
    expect(checkCountLimit(5, 0, 6).allowed).toBe(false);
  });

  it("uses UTC day and month periods", () => {
    const now = new Date("2026-10-06T23:59:59.000Z");
    expect(usagePeriod("scored_leads_per_day", now)).toBe("2026-10-06");
    expect(usagePeriod("deep_searches_per_month", now)).toBe("2026-10-01");
  });

  it("decides scan cadence from the plan interval", () => {
    const now = new Date("2026-10-06T12:00:00.000Z");
    expect(isScanDue(null, now, 24)).toBe(true);
    expect(isScanDue(new Date("2026-10-06T03:00:00.000Z"), now, 24)).toBe(false);
    expect(isScanDue(new Date("2026-10-05T12:05:00.000Z"), now, 24)).toBe(true); // within cron jitter
    expect(isScanDue(new Date("2026-10-06T08:55:00.000Z"), now, 3)).toBe(true);
    expect(isScanDue(new Date("2026-10-06T10:00:00.000Z"), now, 3)).toBe(false);
  });

  it("lets database rows override defaults and falls back to free rows", () => {
    const merged = mergeLimits("pro", [
      { plan: "free", key: "keywords", value: 7 },
      { plan: "pro", key: "projects", value: 9 },
      { plan: "pro", key: "unknown_key", value: 1 },
    ]);
    expect(merged.keywords).toBe(7); // free row overrides the pro default only when pro has no row
    expect(merged.projects).toBe(9);
    expect(merged.scored_leads_per_day).toBe(100);
    expect(merged).not.toHaveProperty("unknown_key");
  });

  it("keeps the code defaults identical to the migration seed", () => {
    const sqlText = readFileSync(resolve(process.cwd(), "drizzle/0012_flowery_salo.sql"), "utf8");
    const seeded = [...sqlText.matchAll(/\('(\w+)', '(\w+)', (\d+)\)/g)].map((m) => [m[1], m[2], Number(m[3])] as const);
    expect(seeded).toHaveLength(2 * LIMIT_KEYS.length);
    for (const [plan, key, value] of seeded) {
      expect(DEFAULT_LIMITS[plan as "free" | "pro"][key as (typeof LIMIT_KEYS)[number]]).toBe(value);
    }
  });
});

describe("keyword and source limits", () => {
  it("allows 5 keywords on free and refuses a 6th with a clear message", async () => {
    await expect(assertWithinCount("ws", "keywords", 0, 5)).resolves.toBeUndefined();
    const error = await assertWithinCount("ws", "keywords", 0, 6).catch((e) => e);
    expect(error).toBeInstanceOf(PlanLimitError);
    expect(error.message).toBe("Your Free plan allows 5 keywords. Upgrade for more.");
    expect(error.code).toBe("plan_limit_exceeded");
  });

  it("reads limits from the database so SQL edits take effect without a deploy", async () => {
    state.limitRows = [{ plan: "free", key: "keywords", value: 7 }];
    await expect(assertWithinCount("ws", "keywords", 0, 7)).resolves.toBeUndefined();
    await expect(assertWithinCount("ws", "keywords", 0, 8)).rejects.toBeInstanceOf(PlanLimitError);
  });

  it("gives Pro 25 keywords", async () => {
    state.workspaceRows = [{ plan: "pro" }];
    await expect(assertWithinCount("ws", "keywords", 0, 25)).resolves.toBeUndefined();
    await expect(assertWithinCount("ws", "keywords", 0, 26)).rejects.toBeInstanceOf(PlanLimitError);
  });

  it("caps sources by plan", async () => {
    await expect(assertWithinCount("ws", "sources", 7)).resolves.toBeUndefined();
    await expect(assertWithinCount("ws", "sources", 8)).rejects.toBeInstanceOf(PlanLimitError);
  });
});

describe("project limit", () => {
  it("lets a free user create their first project but not a second", async () => {
    state.workspaceRows = [];
    await expect(assertCanCreateProject("user")).resolves.toBeUndefined();
    state.workspaceRows = [{ plan: "free" }];
    const error = await assertCanCreateProject("user").catch((e) => e);
    expect(error).toBeInstanceOf(PlanLimitError);
    expect(error.message).toBe("Your Free plan allows 1 projects. Upgrade for more.");
  });

  it("lets a Pro user own three projects", async () => {
    state.workspaceRows = [{ plan: "pro" }, { plan: "free" }];
    await expect(assertCanCreateProject("user")).resolves.toBeUndefined();
    state.workspaceRows = [{ plan: "pro" }, { plan: "pro" }, { plan: "pro" }];
    await expect(assertCanCreateProject("user")).rejects.toBeInstanceOf(PlanLimitError);
  });
});

describe("atomic consume", () => {
  it("issues exactly one guarded upsert statement per call", async () => {
    await consume("ws", "scored_leads_per_day", 1, new Date("2026-10-06T00:00:00Z"));
    expect(state.executed).toHaveLength(1);
    const text = state.executed[0]!.sql.toLowerCase();
    expect(text).toContain("insert into \"workspace_usage\"");
    expect(text).toContain("on conflict (\"workspace_id\", \"period\") do update");
    expect(text).toContain("where \"workspace_usage\".\"scored_leads\" +");
    expect(text).toContain("\"plan_limit\""); // limit is read inside the statement
    expect(state.executed[0]!.params.slice(0, 3)).toEqual(["ws", "2026-10-06", 1]);
  });

  it("allows up to the limit, then refuses without consuming (sequential statements)", async () => {
    const results = [];
    for (let i = 0; i < 22; i++) results.push(await consume("ws", "scored_leads_per_day", 1));
    expect(results.filter((r) => r.allowed)).toHaveLength(20);
    expect(results[19]).toMatchObject({ allowed: true, used: 20, limit: 20 });
    expect(results[20]).toMatchObject({ allowed: false, consumed: 0, limit: 20 });
    expect(state.counter).toBe(20);
  });

  it("refuses a multi-unit request that would exceed the limit and takes nothing", async () => {
    state.counter = 18;
    const result = await consume("ws", "scored_leads_per_day", 5);
    expect(result).toMatchObject({ allowed: false, consumed: 0 });
    expect(state.counter).toBe(18);
  });

  it("rejects non-positive amounts", async () => {
    await expect(consume("ws", "scored_leads_per_day", 0)).rejects.toThrow();
    expect(state.executed).toHaveLength(0);
  });
});
