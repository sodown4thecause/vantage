import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

type Pick = { rank: number | null; opportunityId: string };
const state = vi.hoisted(() => ({
  rows: [] as Array<{ rank: number | null; opportunityId: string }>,
  wheres: [] as Array<{ sql: string; params: unknown[] }>,
  updates: [] as Array<{ set: Record<string, unknown>; params: unknown[] }>,
  upserts: [] as Array<Record<string, unknown>[]>,
  deletes: 0,
  upsertError: null as unknown,
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
          return {
            orderBy: async () => state.rows.filter((row) => row.rank !== null).sort((a, b) => a.rank! - b.rank!),
          };
        },
      }),
    }),
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: async (condition: SQL) => {
          const query = new PgDialect().sqlToQuery(condition);
          state.updates.push({ set, params: query.params });
          for (const row of state.rows) if (query.params.includes(row.opportunityId)) Object.assign(row, set);
        },
      }),
    }),
    insert: () => ({
      values: (values: Array<Record<string, unknown>>) => ({
        onConflictDoUpdate: async (config: { setWhere: SQL }) => {
          expect(new PgDialect().sqlToQuery(config.setWhere).sql).toContain('"rank" is null');
          if (state.upsertError) throw state.upsertError;
          state.upserts.push(values);
          for (const value of values) {
            const existing = state.rows.find((row) => row.opportunityId === value.opportunityId);
            if (!existing) state.rows.push({ rank: value.rank as number, opportunityId: value.opportunityId as string });
            else if (existing.rank === null) existing.rank = value.rank as number;
          }
        },
      }),
    }),
    delete: () => ({ where: async () => { state.deletes += 1; } }),
  }),
}));

import { ensureTodaysPicks } from "@/lib/retention/picks";

const card = (id: string) => ({ id, title: id });
const now = new Date("2026-10-23T20:30:00Z");
const held = (ids: string[]): Pick[] => ids.map((opportunityId, index) => ({ rank: index + 1, opportunityId }));

beforeEach(() => {
  state.rows = [];
  state.wheres = [];
  state.updates = [];
  state.upserts = [];
  state.deletes = 0;
  state.upsertError = null;
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
    expect(state.upserts[0]).toEqual([
      expect.objectContaining({ workspaceId: "ws-1", pickDate: "2026-10-24", rank: 1, opportunityId: "a" }),
      expect.objectContaining({ rank: 2, opportunityId: "b" }),
      expect.objectContaining({ rank: 3, opportunityId: "c" }),
    ]);
    expect(result.cards.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("never exceeds five picks a day and keeps the same list on later visits", async () => {
    state.rows = held(["a", "b", "c", "d", "e"]);
    state.eligible = new Set(["a", "b", "c", "d", "e"]);
    const result = await ensureTodaysPicks({ workspaceId: "ws-1", timeZone: "UTC", now });
    expect(state.upserts).toHaveLength(0);
    expect(state.updates).toHaveLength(0);
    expect(state.queue.mock.calls.every(([opts]) => opts.onlyIds)).toBe(true);
    expect(result.cards.map((c) => c.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("tops up only the free ranks, and skips today's own picks when choosing", async () => {
    state.rows = [{ rank: 1, opportunityId: "a" }, { rank: 3, opportunityId: "c" }];
    state.eligible = new Set(["a", "c", "x", "y", "z"]);
    state.fresh = ["x", "y", "z"];
    await ensureTodaysPicks({ workspaceId: "ws-1", timeZone: "UTC", now });
    const freshCall = state.queue.mock.calls.find(([opts]) => !opts.onlyIds)![0];
    expect(freshCall).toMatchObject({ limit: 3, excludeIds: ["a", "c"] });
    expect(state.upserts[0]!.map((row) => [row.rank, row.opportunityId])).toEqual([[2, "x"], [4, "y"], [5, "z"]]);
  });

  it("frees the slots of ineligible picks but keeps their rows as shown history", async () => {
    state.rows = held(["a", "b", "c", "d", "e"]);
    state.eligible = new Set(["a", "x", "y"]);
    state.fresh = ["x", "y"];
    const result = await ensureTodaysPicks({ workspaceId: "ws-1", timeZone: "UTC", now });

    expect(state.deletes).toBe(0);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]!.set).toEqual({ rank: null });
    expect(state.updates[0]!.params).toEqual(expect.arrayContaining(["ws-1", "2026-10-23", "b", "c", "d", "e"]));
    expect(state.rows.map((row) => row.opportunityId).sort()).toEqual(["a", "b", "c", "d", "e", "x", "y"]);
    expect(state.rows.filter((row) => row.rank === null).map((row) => row.opportunityId).sort()).toEqual(["b", "c", "d", "e"]);
    expect(state.upserts[0]!.map((row) => [row.rank, row.opportunityId])).toEqual([[2, "x"], [3, "y"]]);
    expect(result.cards.map((c) => c.id)).toEqual(["a", "x", "y"]);
  });

  it("survives a profile gap: picks released while nothing is eligible are restored, not repeated or lost", async () => {
    state.rows = held(["a", "b"]);
    await ensureTodaysPicks({ workspaceId: "ws-1", timeZone: "UTC", now });
    expect(state.rows).toEqual([{ rank: null, opportunityId: "a" }, { rank: null, opportunityId: "b" }]);

    state.eligible = new Set(["a", "b"]);
    state.fresh = ["a", "b"];
    const result = await ensureTodaysPicks({ workspaceId: "ws-1", timeZone: "UTC", now });
    expect(state.rows).toEqual([{ rank: 1, opportunityId: "a" }, { rank: 2, opportunityId: "b" }]);
    expect(result.cards.map((c) => c.id)).toEqual(["a", "b"]);
    expect(state.deletes).toBe(0);
  });

  it("tolerates a concurrent visit taking the same slot", async () => {
    state.fresh = ["a"];
    state.eligible = new Set(["a"]);
    state.upsertError = Object.assign(new Error("duplicate key"), { code: "23505" });
    await expect(ensureTodaysPicks({ workspaceId: "ws-1", timeZone: "UTC", now })).resolves.toMatchObject({ cards: [] });
    state.upsertError = new Error("connection lost");
    await expect(ensureTodaysPicks({ workspaceId: "ws-1", timeZone: "UTC", now })).rejects.toThrow("connection lost");
  });

  it("shows fewer than five on a quiet day instead of repeating old picks", async () => {
    const result = await ensureTodaysPicks({ workspaceId: "ws-1", timeZone: "UTC", now });
    expect(state.upserts).toHaveLength(0);
    expect(result.cards).toEqual([]);
  });

  it("reads and writes picks for the requested workspace only", async () => {
    state.rows = held(["a", "b"]);
    state.eligible = new Set(["a"]);
    await ensureTodaysPicks({ workspaceId: "ws-1", timeZone: "UTC", now });
    for (const where of state.wheres) {
      expect(where.sql).toContain('"workspace_id" = $');
      expect(where.params).toContain("ws-1");
    }
    expect(state.updates[0]!.params).toContain("ws-1");
    expect(state.queue.mock.calls.every(([opts]) => opts.workspaceId === "ws-1")).toBe(true);
  });
});
