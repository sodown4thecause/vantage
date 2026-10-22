import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

const state = vi.hoisted(() => ({
  selects: [] as { table: unknown; where: SQL; limit?: number }[],
  owned: true,
  batch: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    select: () => {
      const query = { table: undefined as unknown, where: undefined as unknown as SQL, limit: undefined as number | undefined };
      const builder = {
        from: (table: unknown) => { query.table = table; return builder; },
        where: (where: SQL) => { query.where = where; return builder; },
        orderBy: () => builder,
        limit: (limit: number) => { query.limit = limit; return builder; },
        then: (resolve: (rows: unknown[]) => unknown) => {
          state.selects.push(query);
          return Promise.resolve(state.owned && query.limit === 1 ? [{ id: "conversation", title: "Research" }] : []).then(resolve);
        },
      };
      return builder;
    },
    insert: (table: unknown) => ({ values: (values: unknown) => ({ operation: "insert", table, values }) }),
    update: (table: unknown) => ({ set: (values: unknown) => ({ where: (where: SQL) => ({ operation: "update", table, values, where }) }) }),
    batch: state.batch,
  }),
}));

import { appendTurn, ConversationNotFoundError, getConversation, listConversations } from "@/lib/seo-agent/conversations";
import { seoConversation, seoMessage } from "@/lib/db/schema";

const workspace = "workspace-a";
const conversation = "conversation-a";
const dialect = new PgDialect();
const compiled = (index = 0) => dialect.sqlToQuery(state.selects[index]!.where);

beforeEach(() => {
  state.selects = [];
  state.owned = true;
  state.batch.mockReset().mockResolvedValue([]);
});

describe("conversation lane query boundaries", () => {
  it.each(["research", "gtm"] as const)("filters %s in the database before limiting the history", async (kind) => {
    await listConversations(workspace, 5, kind);
    const { sql, params } = compiled();
    expect(state.selects[0]).toMatchObject({ table: seoConversation, limit: 5 });
    expect(sql).toContain('"seo_conversation"."workspace_id" =');
    expect(sql).toContain('"seo_message"."conversation_id" = "seo_conversation"."id"');
    expect(sql).toContain('"seo_message"."workspace_id" =');
    expect(params.filter((value) => value === workspace)).toHaveLength(3);
    if (kind === "research") expect(params).toContain("Product setup interview");
    expect(params).toContain(JSON.stringify({ cards: [{ tool: "onboarding_interview" }] }));
    expect(params).toContain(JSON.stringify({ cards: [{ tool: "gtm_journey" }] }));
    expect(sql.match(/not exists/g)).toHaveLength(kind === "research" ? 2 : 1);
  });

  it("preserves the unfiltered default used by interview discovery", async () => {
    await listConversations(workspace);
    expect(compiled().params).toEqual([workspace]);
    expect(compiled().sql).not.toContain("exists");
  });

  it("applies the same lane boundary before fetching a selected conversation's messages", async () => {
    await getConversation(workspace, conversation, "research");
    expect(compiled().params).toEqual(expect.arrayContaining([workspace, conversation, "Product setup interview"]));
    expect(compiled().sql).toContain("not exists");
    expect(state.selects[1]!.table).toBe(seoMessage);
    expect(compiled(1).params).toEqual([conversation, workspace]);
  });

  it("does not read messages when the scoped conversation is missing", async () => {
    state.owned = false;
    expect(await getConversation(workspace, conversation, "research")).toBeNull();
    expect(state.selects).toHaveLength(1);
  });
});

describe("atomic GTM turn persistence", () => {
  it("sends both roles in one insert and the scoped timestamp bump in one batch", async () => {
    const parts = { cards: [{ tool: "gtm_journey", title: "Next", fetchedAt: null, cached: false, data: {} }] };
    await appendTurn(workspace, conversation, { content: "Question" }, { content: "Answer", parts });
    expect(compiled().params).toEqual([conversation, workspace]);
    expect(state.batch).toHaveBeenCalledOnce();
    const [insert, update] = state.batch.mock.calls[0]![0];
    expect(insert.table).toBe(seoMessage);
    expect(insert.values).toEqual([
      expect.objectContaining({ workspaceId: workspace, conversationId: conversation, role: "user", content: "Question" }),
      expect.objectContaining({ workspaceId: workspace, conversationId: conversation, role: "assistant", content: "Answer", parts }),
    ]);
    expect(insert.values[1].createdAt.getTime()).toBeGreaterThan(insert.values[0].createdAt.getTime());
    expect(update.table).toBe(seoConversation);
    expect(dialect.sqlToQuery(update.where).params).toEqual([conversation, workspace]);
  });

  it("refuses a foreign conversation without submitting any writes", async () => {
    state.owned = false;
    await expect(appendTurn(workspace, conversation, { content: "Question" }, { content: "Answer" })).rejects.toBeInstanceOf(ConversationNotFoundError);
    expect(state.batch).not.toHaveBeenCalled();
  });

  it("propagates a rejected atomic batch instead of reporting a stored turn", async () => {
    state.batch.mockRejectedValue(new Error("database unavailable"));
    await expect(appendTurn(workspace, conversation, { content: "Question" }, { content: "Answer" })).rejects.toThrow("database unavailable");
    expect(state.batch).toHaveBeenCalledOnce();
  });

  it("creates a new conversation in the same atomic batch as its paired messages", async () => {
    const { id } = await appendTurn(workspace, { title: "New GTM question" }, { content: "Question" }, { content: "Answer" });
    expect(state.selects).toHaveLength(0);
    expect(state.batch).toHaveBeenCalledOnce();
    const [create, insert, update] = state.batch.mock.calls[0]![0];
    expect(create).toMatchObject({ table: seoConversation, values: { id, workspaceId: workspace, title: "New GTM question" } });
    expect(insert.values).toHaveLength(2);
    expect(insert.values.every((row: { conversationId: string }) => row.conversationId === id)).toBe(true);
    expect(dialect.sqlToQuery(update.where).params).toEqual([id, workspace]);
  });
});
