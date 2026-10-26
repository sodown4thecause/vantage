import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({ condition: undefined as unknown, query: undefined as unknown, select: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({ select: mocks.select, update: mocks.update }) }));

import { getContentBrandVoiceProfile, getContentThread, getContentThreadContext, updateContentDraft } from "@/lib/content-agent/repository";

const workspaceId = "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a11";
const threadId = "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a12";

beforeEach(() => {
  const query = {
    from: vi.fn(() => query),
    where: vi.fn((condition: unknown) => { mocks.condition = condition; return query; }),
    orderBy: vi.fn(() => query),
    limit: vi.fn(async () => []),
  };
  const updateQuery = {
    set: vi.fn(() => updateQuery),
    where: vi.fn((condition: unknown) => { mocks.condition = condition; return updateQuery; }),
    returning: vi.fn(async () => []),
  };
  mocks.condition = undefined;
  mocks.query = query;
  mocks.select.mockReset().mockReturnValue(query);
  mocks.update.mockReset().mockReturnValue(updateQuery);
});

describe("Content repository", () => {
  it("requires both the workspace and thread IDs when loading a thread", async () => {
    await expect(getContentThread(workspaceId, threadId)).resolves.toBeNull();
    expect(mocks.select).toHaveBeenCalledOnce();
    const query = new PgDialect().sqlToQuery(mocks.condition as never);
    expect(query.sql).toContain('"content_thread"."workspace_id" = $1');
    expect(query.sql).toContain('"content_thread"."id" = $2');
    expect(query.params).toEqual([workspaceId, threadId]);
  });

  it("limits model context reads to the newest 40 scoped messages", async () => {
    const thread = { id: threadId, workspaceId, title: "Draft" };
    const recentMessage = { id: "message", createdAt: new Date("2026-01-01T00:00:00Z") };
    const query = mocks.query as { limit: ReturnType<typeof vi.fn>; orderBy: ReturnType<typeof vi.fn> };
    query.limit.mockResolvedValueOnce([thread]).mockResolvedValueOnce([recentMessage]);

    const result = await getContentThreadContext(workspaceId, threadId);

    expect(result?.thread).toEqual(thread);
    expect(result?.messages).toEqual([recentMessage]);
    expect(query.limit).toHaveBeenLastCalledWith(40);
    const filter = new PgDialect().sqlToQuery(mocks.condition as never);
    expect(filter.sql).toContain('"content_message"."workspace_id" = $1');
    expect(filter.sql).toContain('"content_message"."thread_id" = $2');
    expect(filter.params).toEqual([workspaceId, threadId]);
    const order = new PgDialect().sqlToQuery(query.orderBy.mock.calls.at(-1)?.[0] as never);
    expect(order.sql).toContain('"content_message"."created_at" desc');
  });

  it("updates a Content draft only when both its ID and workspace match", async () => {
    const draftId = "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a13";
    await expect(updateContentDraft({ workspaceId, draftId, title: "Edited", body: "Updated copy" })).resolves.toBeNull();
    expect(mocks.update).toHaveBeenCalledOnce();
    const updateQuery = mocks.update.mock.results[0]?.value as { set: ReturnType<typeof vi.fn> };
    expect(updateQuery.set).toHaveBeenCalledWith(expect.objectContaining({ title: "Edited", body: "Updated copy" }));
    const filter = new PgDialect().sqlToQuery(mocks.condition as never);
    expect(filter.sql).toContain('"content_draft"."workspace_id" = $1');
    expect(filter.sql).toContain('"content_draft"."id" = $2');
    expect(filter.params).toEqual([workspaceId, draftId]);
  });

  it("loads the brand voice only from the requested workspace", async () => {
    await expect(getContentBrandVoiceProfile(workspaceId)).resolves.toBeNull();
    expect(mocks.select).toHaveBeenCalledOnce();
    const query = new PgDialect().sqlToQuery(mocks.condition as never);
    expect(query.sql).toContain('"content_brand_voice_profile"."workspace_id" = $1');
    expect(query.params).toEqual([workspaceId]);
  });
});
