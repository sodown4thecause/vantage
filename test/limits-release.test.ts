import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ statements: [] as Array<{ sql: string; params: unknown[] }>, fail: false }));

vi.mock("@/lib/db/client", () => {
  const dialect = new PgDialect();
  return {
    getDb: () => ({
      execute: async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
        if (state.fail) throw new Error("db down");
        const { sql, params } = dialect.sqlToQuery(query);
        state.statements.push({ sql, params });
        return { rows: [] };
      },
    }),
  };
});

import { release } from "@/lib/plans/limits";

beforeEach(() => {
  state.statements = [];
  state.fail = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("release", () => {
  it("gives units back for the current period and never goes below zero", async () => {
    await release("11111111-1111-1111-1111-111111111111", "scored_leads_per_day", 1, new Date("2026-10-06T12:00:00Z"));
    expect(state.statements).toHaveLength(1);
    const { sql, params } = state.statements[0]!;
    expect(sql).toContain("greatest(");
    expect(sql).toContain('"workspace_usage"');
    expect(params).toContain("2026-10-06");
  });

  it("does not throw when the database is down, so cleanup never hides the original error", async () => {
    state.fail = true;
    await expect(release("11111111-1111-1111-1111-111111111111", "scored_leads_per_day")).resolves.toBeUndefined();
  });
});
