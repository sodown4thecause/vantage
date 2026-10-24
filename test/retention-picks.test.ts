import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  today: [] as Array<{ rank: number; opportunityId: string }>,
  inserted: [] as Row[],
  deleted: [] as Array<{ sql: string; params: unknown[] }>,
  wheres: [] as Array<{ sql: string; params: unknown[] }>,
  eligible: new Set<string>(),
  fresh: [] as string[],
  queue: vi.fn(),
}));

vi.mock("@/lib/opportunities/run", () => ({ listOpportunityQueue: state.queue }));
vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: (condition: SQL) => {
          const query = new PgDialect().sqlToQuery(condition);
          state.wheres.push({ sql: query.sql, params: query.params });
          return { orderBy: async () => [...state.today].sort((a, b) => a.rank - b.rank) };
        },
      }),
    }),
    insert: () => ({
      values: (values: Row[]) => ({
        onConflictDoNothing: async () => {
          state.inserted.push(...values);
          state.today.push(...values.map((value) => ({ rank: value.rank as number, opportunityId: value.opportunityId as string })));
        },
      }),
    }),
    delete: () => ({
      where: async (condition: SQL) => {
        const query = new PgDialect().sqlToQuery(condition);
        state.deleted.push({ sql: query.sql, params: query.params });
        state.today = state.today.filter((pick) => !query.params.includes(pick.opportunityId));
      },
    }),
  }),
}));

import { ensureTodaysPicks } from "@/lib/retention/picks";

const card = (id: string) => ({ id, title: id });
const now = new Date("2026-10-23T20:30:00Z");

beforeEach(() => {
  state.today = [];
  state.inserted = [];
  state.deleted = [];
  state.wheres = [];
  state.eligible = new Set();
  state.fresh = [];
  state.queue.mockReset();
  state.queue.mockImplementation(async (opts: { onlyIds?: string[] }) =>
    opts.onlyIds ? opts.onlyIds.filter((id) => state.eligible.has(id)).map(card) : state.fresh.map(card));
});

describe("ensureTodaysPicks", () => {
  it("fixes the first visit of the local day to opportunities never picked on another day", async () => {
    state.fresh = ["a", "b", "c"];
    state.eligible = new Set(state.fresh);
    const result = await ensureTodaysPicks({ workspaceId: "ws-1", timeZone: "Australia/Sydney", now });

    expect(result.day).toBe("2026-10-24");
    const freshCall = state.queue.mock.calls.find(([opts]) => !opts.onlyIds)![0];
    expect(freshCall).toMatchObject({ workspaceId: "ws-1", limit: 5, excludeIds: [], notPickedBeforeDay: "2026-10-24" });
    expect(state.inserted).toEqual([
      expect.objectContaining({ workspaceId: "ws-1", pickDate: "2026-10-24", rank: 1, opportunityId: "a" }),
      expect.objectContaining({ rank: 2, opportunityId: "b" }),
      expect.objectContaining({ rank: 3, opportunityId: "c" }),
    ]);
    expect(result.cards.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("never exceeds five picks a day and keeps the same list on later visits", async () => {
    state.today = ["a", "b", "c", "d", "e"].map((opportunityId, index) => ({ rank: index + 1, opportunityId }));
    state.eligible = new Set(["a", "b", "c", "d", "e"]);
    const result = await ensureTodaysPicks({ workspaceId: "ws-1", timeZone: "UTC", now });
    expect(state.inserted).toHaveLength(0);
    expect(state.deleted).toHaveLength(0);
    expect(state.queue.mock.calls.every(([opts]) => opts.onlyIds)).toBe(true);
    expect(result.cards.map((c) => c.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("tops up only the free ranks, and skips today's own picks when choosing", async () => {
    state.today = [{ rank: 1, opportunityId: "a" }, { rank: 3, opportunityId: "c" }];
    state.eligible = new Set(["a", "c", "x", "y", "z"]);
    state.fresh = ["x", "y", "z"];
    await ensureTodaysPicks({ workspaceId: "ws-1", timeZone: "UTC", now });
    const freshCall = state.queue.mock.calls.find(([opts]) => !opts.onlyIds)![0];
    expect(freshCall).toMatchObject({ limit: 3, excludeIds: ["a", "c"] });
    expect(state.inserted.map((row) => [row.rank, row.opportunityId])).toEqual([[2, "x"], [4, "y"], [5, "z"]]);
  });

  it("frees the slots of picks a scan or profile change made ineligible, so the day does not stay empty", async () => {
    state.today = ["a", "b", "c", "d", "e"].map((opportunityId, index) => ({ rank: index + 1, opportunityId }));
    state.eligible = new Set(["a", "x", "y"]);
    state.fresh = ["x", "y"];
    const result = await ensureTodaysPicks({ workspaceId: "ws-1", timeZone: "UTC", now });
    expect(state.deleted).toHaveLength(1);
    expect(state.deleted[0]!.params).toEqual(expect.arrayContaining(["ws-1", "2026-10-23", "b", "c", "d", "e"]));
    expect(state.deleted[0]!.params).not.toContain("a");
    expect(state.inserted.map((row) => [row.rank, row.opportunityId])).toEqual([[2, "x"], [3, "y"]]);
    expect(result.cards.map((c) => c.id)).toEqual(["a", "x", "y"]);
  });

  it("shows fewer than five on a quiet day instead of repeating old picks", async () => {
    const result = await ensureTodaysPicks({ workspaceId: "ws-1", timeZone: "UTC", now });
    expect(state.inserted).toHaveLength(0);
    expect(result.cards).toEqual([]);
  });

  it("reads and writes picks for the requested workspace only", async () => {
    state.today = [{ rank: 1, opportunityId: "a" }];
    await ensureTodaysPicks({ workspaceId: "ws-1", timeZone: "UTC", now });
    for (const where of state.wheres) {
      expect(where.sql).toContain('"workspace_id" = $');
      expect(where.params).toContain("ws-1");
    }
    expect(state.queue.mock.calls.every(([opts]) => opts.workspaceId === "ws-1")).toBe(true);
  });
});
