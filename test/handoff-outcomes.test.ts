import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  allowed: true,
  opportunityFound: true,
  inserted: [] as Row[],
  wheres: [] as Array<{ sql: string; params: unknown[] }>,
}));

vi.mock("@/lib/auth/workspace", () => ({
  authorizeWorkspace: async () => (state.allowed ? { ok: true, userId: "u" } : { ok: false, status: 401, error: "unauthorized" }),
}));
vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: (condition: SQL) => {
          const query = new PgDialect().sqlToQuery(condition);
          state.wheres.push({ sql: query.sql, params: query.params });
          return { limit: async () => (state.wheres.length === 1 && state.opportunityFound ? [{ id: "op-1" }] : []) };
        },
      }),
    }),
    insert: () => ({
      values: (values: Row) => ({
        returning: async () => {
          state.inserted.push(values);
          return [{ id: "out-1", draftId: null, idempotencyKey: null, payload: {}, createdAt: new Date("2026-10-24T01:00:00Z"), ...values }];
        },
      }),
    }),
  }),
}));

import { POST } from "@/app/api/outcomes/route";

const post = (body: Record<string, unknown>) =>
  POST(new Request("https://vantage.test/api/outcomes", { method: "POST", body: JSON.stringify({ workspaceId: "ws-1", opportunityId: "op-1", ...body }) }));

beforeEach(() => {
  state.allowed = true;
  state.opportunityFound = true;
  state.inserted = [];
  state.wheres = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("handoff outcome events", () => {
  it.each(["copy", "open", "sent", "replied"])("records a %s event against the draft and conversation", async (event) => {
    const response = await post({ event, draftId: "draft-1", payload: { documentId: "doc-1" }, idempotencyKey: `op-1:${event}:1` });
    expect(response.status).toBe(201);
    expect(state.inserted).toEqual([
      expect.objectContaining({ workspaceId: "ws-1", opportunityId: "op-1", draftId: "draft-1", event, payload: { documentId: "doc-1" } }),
    ]);
  });

  it("rejects an event Vantage cannot know about, such as the reply being posted", async () => {
    for (const event of ["posted", "published", "reply_posted"]) {
      expect((await post({ event })).status).toBe(400);
    }
    expect(state.inserted).toHaveLength(0);
  });

  it("refuses signed-out callers before touching the database", async () => {
    state.allowed = false;
    expect((await post({ event: "copy" })).status).toBe(401);
    expect(state.wheres).toHaveLength(0);
    expect(state.inserted).toHaveLength(0);
  });

  it("does not record an event for an opportunity outside the workspace", async () => {
    state.opportunityFound = false;
    const response = await post({ event: "copy" });
    expect(response.status).toBe(404);
    expect(state.wheres[0]!.sql).toContain('"opportunity"."workspace_id" = $');
    expect(state.wheres[0]!.params).toContain("ws-1");
    expect(state.inserted).toHaveLength(0);
  });
});
