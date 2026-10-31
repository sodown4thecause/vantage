import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

const state = vi.hoisted(() => ({
  listWhere: undefined as unknown,
  updateWhere: undefined as unknown,
  set: undefined as unknown,
  limit: vi.fn(),
}));

vi.mock("@/lib/db/client", () => {
  const selectQuery = {
    from: vi.fn(() => selectQuery),
    where: vi.fn((where: unknown) => { state.listWhere = where; return selectQuery; }),
    orderBy: vi.fn(() => selectQuery),
    limit: state.limit,
    then: (resolve: (rows: unknown[]) => unknown) => resolve([]),
  };
  const updateQuery = {
    set: vi.fn((values: unknown) => { state.set = values; return updateQuery; }),
    where: vi.fn((where: unknown) => { state.updateWhere = where; return updateQuery; }),
    returning: vi.fn(async () => [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "ready" }]),
  };
  return { getDb: () => ({ select: () => selectQuery, update: () => updateQuery }) };
});

import { listContentDrafts, updateContentDraftStatus } from "@/lib/content-agent/repository";

const WORKSPACE_A = "11111111-1111-4111-8111-111111111111";
const DRAFT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

beforeEach(() => {
  state.listWhere = undefined;
  state.updateWhere = undefined;
  state.set = undefined;
  state.limit.mockReset();
});

const sql = (where: unknown) => new PgDialect().sqlToQuery(where as SQL);

describe("Content library repository", () => {
  it("loads the full library using only the requested workspace boundary", async () => {
    await expect(listContentDrafts(WORKSPACE_A)).resolves.toEqual([]);

    const query = sql(state.listWhere);
    expect(query.sql).toContain('"content_draft"."workspace_id" = $1');
    expect(query.params).toEqual([WORKSPACE_A]);
    expect(state.limit).not.toHaveBeenCalled();
  });

  it("updates status only when both workspace and draft IDs match", async () => {
    await updateContentDraftStatus(WORKSPACE_A, DRAFT_A, "ready");

    const query = sql(state.updateWhere);
    expect(query.sql).toContain('"content_draft"."workspace_id" = $1');
    expect(query.sql).toContain('"content_draft"."id" = $2');
    expect(query.params).toEqual([WORKSPACE_A, DRAFT_A]);
    expect(state.set).toMatchObject({ status: "ready" });
  });
});
