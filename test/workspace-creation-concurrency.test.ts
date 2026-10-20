import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  db: null as ReturnType<typeof postgres> | null,
  schema: "",
  limit: 1,
}));

vi.mock("@/lib/auth/server", () => ({
  auth: { getSession: async () => ({ data: { user: { id: "owner-a" } } }) },
}));
vi.mock("@/lib/auth/workspace", () => ({
  authorizeWorkspace: vi.fn(),
  getCurrentWorkspace: async () => {
    const rows = await state.db!`select id, name from ${state.db!(state.schema)}.workspace where owner_user_id = 'owner-a'`;
    return rows[0] ?? null;
  },
}));
vi.mock("@/lib/plans/limits", () => ({
  assertCanCreateProject: async () => {
    const [row] = await state.db!`select count(*)::int as n from ${state.db!(state.schema)}.workspace where owner_user_id = 'owner-a'`;
    if (row.n >= state.limit) throw new Error("cap reached");
    return state.limit;
  },
}));
vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    execute: (query: unknown) => query,
    batch: async (queries: Parameters<PgDialect["sqlToQuery"]>[0][]) => state.db!.begin(async (tx) => {
      await tx`set local search_path to ${tx(state.schema)}`;
      const results = [];
      for (const query of queries) {
        const compiled = new PgDialect().sqlToQuery(query);
        results.push(await tx.unsafe(compiled.sql, compiled.params as postgres.ParameterOrJSON<never>[]));
      }
      return results;
    }),
  }),
}));

import { createWorkspaceForCurrentUser } from "@/lib/db/actions";

describe.skipIf(!process.env.TEST_DATABASE_URL)("workspace creation concurrency on PostgreSQL", () => {
  beforeAll(async () => {
    state.db = postgres(process.env.TEST_DATABASE_URL!, { max: 20 });
    state.schema = `creation_test_${randomUUID().replaceAll("-", "")}`;
    await state.db`create schema ${state.db(state.schema)}`;
    await state.db`create table ${state.db(state.schema)}.workspace (
      id uuid primary key default gen_random_uuid(), name text not null,
      owner_user_id text, plan text not null default 'free'
    )`;
  });

  afterAll(async () => {
    if (!state.db) return;
    await state.db`drop schema ${state.db(state.schema)} cascade`;
    await state.db.end();
  });

  beforeEach(async () => {
    state.limit = 1;
    await state.db!`truncate ${state.db!(state.schema)}.workspace`;
  });

  it("returns one workspace to twenty concurrent first-workspace submissions", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => createWorkspaceForCurrentUser(`Tab ${i}`)));
    expect(new Set(results.map((row) => row.id)).size).toBe(1);
    const [count] = await state.db!`select count(*)::int as n from ${state.db!(state.schema)}.workspace`;
    expect(count.n).toBe(1);
  });

  it("allows only one concurrent submission to claim the last Pro workspace slot", async () => {
    state.limit = 3;
    await createWorkspaceForCurrentUser("First");
    await createWorkspaceForCurrentUser("Second", true);
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => createWorkspaceForCurrentUser(`Additional ${i}`, true)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const [count] = await state.db!`select count(*)::int as n from ${state.db!(state.schema)}.workspace`;
    expect(count.n).toBe(3);
  });
});
