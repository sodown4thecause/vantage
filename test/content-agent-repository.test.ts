import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({ condition: undefined as unknown, select: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({ select: mocks.select }) }));

import { getContentThread } from "@/lib/content-agent/repository";

const workspaceId = "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a11";
const threadId = "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a12";

beforeEach(() => {
  const query = {
    from: vi.fn(() => query),
    where: vi.fn((condition: unknown) => { mocks.condition = condition; return query; }),
    limit: vi.fn(async () => []),
  };
  mocks.condition = undefined;
  mocks.select.mockReset().mockReturnValue(query);
});

describe("Content thread repository", () => {
  it("requires both the workspace and thread IDs when loading a thread", async () => {
    await expect(getContentThread(workspaceId, threadId)).resolves.toBeNull();
    expect(mocks.select).toHaveBeenCalledOnce();
    const query = new PgDialect().sqlToQuery(mocks.condition as never);
    expect(query.sql).toContain('"content_thread"."workspace_id" = $1');
    expect(query.sql).toContain('"content_thread"."id" = $2');
    expect(query.params).toEqual([workspaceId, threadId]);
  });
});
