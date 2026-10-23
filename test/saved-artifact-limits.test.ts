import { beforeEach, describe, expect, it, vi } from "vitest";

const queries = vi.hoisted(() => [] as { sql: string; params: unknown[] }[]);

vi.mock("@/lib/db/client", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const db = drizzle(async (sql, params) => {
    queries.push({ sql, params });
    return { rows: [] };
  });
  return { getDb: () => db };
});

import { listSavedArtifacts, MAX_SAVED_ARTIFACTS } from "@/lib/workspace/saved-artifacts";

beforeEach(() => { queries.length = 0; });

describe("saved artifact list limits", () => {
  it("requests the entire allowed collection in workspace-scoped newest-first SQL", async () => {
    await listSavedArtifacts("workspace-a");
    expect(MAX_SAVED_ARTIFACTS).toBe(200);
    expect(queries).toHaveLength(1);
    expect(queries[0]!.sql).toContain('where "saved_artifact"."workspace_id" = $1');
    expect(queries[0]!.sql).toContain('order by "saved_artifact"."created_at" desc limit $2');
    expect(queries[0]!.params).toEqual(["workspace-a", MAX_SAVED_ARTIFACTS]);
  });

  it.each([[20, 20], [1000, 200], [0, 1], [-1, 1], [2.9, 2], [NaN, 200], [Infinity, 200]])(
    "bounds an explicit limit of %s to %s", async (limit, expected) => {
      await listSavedArtifacts("workspace-a", limit);
      expect(queries[0]!.params).toEqual(["workspace-a", expected]);
    },
  );
});
