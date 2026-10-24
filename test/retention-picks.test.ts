import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  today: [] as Array<{ rank: number; opportunityId: string }>,
  earlier: [] as Array<{ opportunityId: string }>,
  inserted: [] as Row[],
  wheres: [] as Array<{ sql: string; params: unknown[] }>,
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
          return {
            orderBy: async () => [...state.today].sort((a, b) => a.rank - b.rank),
            limit: async () => state.earlier,
          };
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
  }),
}));

import { ensureTodaysPicks } from "@/lib/retention/picks";

const card = (id: string) => ({ id, title: id });
const now = new Date("2026-10-23T20:30:00Z");

beforeEach(() => {
  state.today = [];
  state.earlier = [];
  state.inserted = [];
  state.wheres = [];
  state.queue.mockReset();
  state.queue.mockImplementation(async (opts: { onlyIds?: string[] }) =>
    opts.onlyIds ? opts.onlyIds.map(card) : ["a", "b", "c", "d", "e"].map(card));
});

describe("ensureTodaysPicks", () => {
  it("fixes the first visit of the local day to new opportunities only", async () => {
    state.earlier = [{ opportunityId: "yesterday-1" }, { opportunityId: "yesterday-2" }];
    state.queue.mockImplementationOnce(async () => ["a", "b", "c"].map(card));
    const result = await ensureTodaysPicks({ workspaceId: "ws-1", timeZone: "Australia/Sydney", now });

    expect(result.day).toBe("2026-10-24");
    expect(state.queue.mock.calls[0]![0]).toMatchObject({ workspaceId: "ws-1", limit: 5, excludeIds: ["yesterday-1", "yesterday-2"] });
    expect(state.inserted).toEqual([
      expect.objectContaining({ workspaceId: "ws-1", pickDate: "2026-10-24", rank: 1, opportunityId: "a" }),
      expect.objectContaining({ rank: 2, opportunityId: "b" }),
      expect.objectContaining({ rank: 3, opportunityId: "c" }),
    ]);
    expect(state.queue.mock.calls[1]![0]).toMatchObject({ workspaceId: "ws-1", onlyIds: ["a", "b", "c"] });
    expect(result.cards.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("never exceeds five picks a day and keeps the same list on later visits", async () => {
    state.today = ["a", "b", "c", "d", "e"].map((opportunityId, index) => ({ rank: index + 1, opportunityId }));
    const result = await ensureTodaysPicks({ workspaceId: "ws-1", timeZone: "UTC", now });
    expect(state.inserted).toHaveLength(0);
    expect(state.queue).toHaveBeenCalledTimes(1);
    expect(result.cards.map((c) => c.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("tops up only the free ranks, and skips today's own picks when choosing", async () => {
    state.today = [{ rank: 1, opportunityId: "a" }, { rank: 3, opportunityId: "c" }];
    state.queue.mockImplementationOnce(async () => ["x", "y", "z"].map(card));
    await ensureTodaysPicks({ workspaceId: "ws-1", timeZone: "UTC", now });
    expect(state.queue.mock.calls[0]![0]).toMatchObject({ limit: 3, excludeIds: ["a", "c"] });
    expect(state.inserted.map((row) => [row.rank, row.opportunityId])).toEqual([[2, "x"], [4, "y"], [5, "z"]]);
  });

  it("shows fewer than five on a quiet day instead of repeating old picks", async () => {
    state.queue.mockImplementationOnce(async () => []);
    const result = await ensureTodaysPicks({ workspaceId: "ws-1", timeZone: "UTC", now });
    expect(state.inserted).toHaveLength(0);
    expect(result.cards).toEqual([]);
  });

  it("reads and writes picks for the requested workspace only", async () => {
    await ensureTodaysPicks({ workspaceId: "ws-1", timeZone: "UTC", now });
    for (const where of state.wheres) {
      expect(where.sql).toContain('"workspace_id" = $');
      expect(where.params).toContain("ws-1");
    }
    expect(state.queue.mock.calls.every(([opts]) => opts.workspaceId === "ws-1")).toBe(true);
  });
});
