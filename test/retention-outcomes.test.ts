import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({ rows: [] as Row[], where: null as { sql: string; params: unknown[] } | null }));

vi.mock("@/lib/db/client", () => ({
  getDb: () => {
    const chain = {
      from: () => chain,
      innerJoin: () => chain,
      where: (condition: SQL) => {
        const query = new PgDialect().sqlToQuery(condition);
        state.where = { sql: query.sql, params: query.params };
        return chain;
      },
      orderBy: () => chain,
      limit: async () => state.rows,
      groupBy: async () => state.rows,
    };
    return { select: () => chain };
  },
}));

import { listMarkedReplies, monthlyRecap } from "@/lib/retention/outcomes";

beforeEach(() => {
  state.rows = [];
  state.where = null;
});

describe("sent and replied list", () => {
  it("lists each conversation once, newest mark first, as the owner marked it", async () => {
    state.rows = [
      { opportunityId: "o1", event: "replied", createdAt: new Date("2026-10-23T05:00:00Z"), title: "One" },
      { opportunityId: "o2", event: "sent", createdAt: new Date("2026-10-22T05:00:00Z"), title: "Two" },
      { opportunityId: "o1", event: "sent", createdAt: new Date("2026-10-21T05:00:00Z"), title: "One" },
    ];
    expect(await listMarkedReplies({ workspaceId: "ws-1" })).toEqual([
      { opportunityId: "o1", title: "One", state: "replied", markedAt: "2026-10-23T05:00:00.000Z" },
      { opportunityId: "o2", title: "Two", state: "sent", markedAt: "2026-10-22T05:00:00.000Z" },
    ]);
  });

  it("is scoped to the workspace and only reads the owner's sent and replied marks", async () => {
    await listMarkedReplies({ workspaceId: "ws-1" });
    expect(state.where!.sql).toContain('"opportunity_outcome"."workspace_id" = $');
    expect(state.where!.params).toEqual(expect.arrayContaining(["ws-1", "sent", "replied"]));
    expect(state.where!.params).not.toContain("copy");
  });
});

describe("monthly recap", () => {
  it("counts conversations since the start of the workspace's local month", async () => {
    state.rows = [{ event: "copy", conversations: 12 }, { event: "sent", conversations: 7 }];
    const recap = await monthlyRecap({ workspaceId: "ws-1", timeZone: "Australia/Sydney", now: new Date("2026-10-24T05:00:00Z") });
    expect(recap).toEqual({ copied: 12, sent: 7, replied: 0 });
    expect(state.where!.params).toContain("2026-09-30T14:00:00.000Z");
    expect(state.where!.params).toContain("ws-1");
  });
});
