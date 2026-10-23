import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";

const WS_A = "11111111-1111-4111-8111-111111111111";
const WS_B = "22222222-2222-4222-8222-222222222222";
const ART_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ART_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OLD = new Date("2026-10-01T00:00:00.000Z");
const NEW = new Date("2026-10-20T00:00:00.000Z");

const store = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  wheres: [] as string[],
  auth: { ok: true, userId: "user-a" } as { ok: true; userId: string } | { ok: false; status: 401 | 403; error: string },
}));

vi.mock("@/lib/auth/workspace", () => ({ authorizeWorkspace: vi.fn(async () => store.auth) }));

// Evaluates each compiled WHERE clause against the stored rows, so a query only sees rows whose columns match.
vi.mock("@/lib/db/client", async () => {
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const dialect = new PgDialect();
  const camel = (column: string) => column.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  const matches = (row: Record<string, unknown>, pred: SQL) => {
    const { sql: text, params } = dialect.sqlToQuery(pred);
    store.wheres.push(text);
    for (const [, column, index] of text.matchAll(/(?:"\w+"\.)?"(\w+)" = \$(\d+)/g)) {
      if (row[camel(column!)] !== params[Number(index) - 1]) return false;
    }
    return true;
  };
  const db = {
    select: () => {
      let where: SQL;
      let limit = Infinity;
      const builder = {
        from: () => builder,
        where: (pred: SQL) => { where = pred; return builder; },
        orderBy: () => builder,
        limit: (n: number) => { limit = n; return builder; },
        then: (resolve: (rows: unknown[]) => unknown) => resolve(store.rows.filter((row) => matches(row, where))
          .sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime()).slice(0, limit)),
      };
      return builder;
    },
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => {
          const row = { id: crypto.randomUUID(), createdAt: NEW, ...values };
          store.rows.push(row);
          return [row];
        },
      }),
    }),
    delete: () => ({
      where: (pred: SQL) => ({
        returning: async () => {
          const removed = store.rows.filter((row) => matches(row, pred));
          store.rows = store.rows.filter((row) => !removed.includes(row));
          return removed.map((row) => ({ id: row.id }));
        },
      }),
    }),
  };
  return { getDb: () => db };
});

import { DELETE } from "@/app/api/workspace/artifacts/[id]/route";
import { GET, POST } from "@/app/api/workspace/artifacts/route";
import type { Block } from "@/lib/workspace/blocks";
import { createSavedArtifact, deleteSavedArtifact, listSavedArtifacts } from "@/lib/workspace/saved-artifacts";

const table: Block = { type: "table", title: "Backlinks", columns: ["Domain"], rows: [["a.com"]] };

beforeEach(() => {
  store.auth = { ok: true, userId: "user-a" };
  store.wheres = [];
  store.rows = [
    { id: ART_A, workspaceId: WS_A, lane: "seo", title: "Older", blocks: [table], createdBy: "user-a", createdAt: OLD },
    { id: ART_B, workspaceId: WS_B, lane: "gtm", title: "Other workspace", blocks: [table], createdBy: "user-b", createdAt: NEW },
  ];
});

describe("saved artifact repository", () => {
  it("returns every allowed saved item, including items older than the first fifty", async () => {
    for (let index = 1; index < 200; index++) {
      await createSavedArtifact(WS_A, { lane: "gtm", title: `Saved ${index}`, blocks: [table], createdBy: "user-a" });
    }
    const response = await GET(new Request(`http://test/api/workspace/artifacts?workspaceId=${WS_A}`));
    expect(response.status).toBe(200);
    const body = await response.json() as { artifacts: { id: string }[] };
    expect(body.artifacts).toHaveLength(200);
    expect(body.artifacts.at(-1)?.id).toBe(ART_A);
    expect(await listSavedArtifacts(WS_A)).toHaveLength(200);
    expect((await listSavedArtifacts(WS_A)).at(-1)?.id).toBe(ART_A);
  });

  it("lists only the workspace's artifacts, newest first", async () => {
    await createSavedArtifact(WS_A, { lane: "gtm", title: "Newer", blocks: [table], createdBy: "user-a" });
    const list = await listSavedArtifacts(WS_A);
    expect(list.map((item) => item.title)).toEqual(["Newer", "Older"]);
    expect(store.wheres.every((where) => where.includes("\"workspace_id\" = $"))).toBe(true);
  });

  it("never deletes another workspace's artifact", async () => {
    expect(await deleteSavedArtifact(WS_A, ART_B)).toBe(false);
    expect(store.rows.some((row) => row.id === ART_B)).toBe(true);
    expect(await deleteSavedArtifact(WS_A, ART_A)).toBe(true);
    expect(store.rows.some((row) => row.id === ART_A)).toBe(false);
  });

  it("re-validates stored blocks on read and falls back to text", async () => {
    store.rows[0]!.blocks = [{ type: "chart", title: "Bad chart" }];
    const [artifact] = await listSavedArtifacts(WS_A);
    expect(artifact!.blocks).toEqual([{ type: "text", text: "Bad chart (this visual couldn't be displayed)" }]);
  });
});

describe("saved artifact routes", () => {
  const post = (body: unknown) => POST(new Request("http://test/api/workspace/artifacts", { method: "POST", body: JSON.stringify(body) }));

  it("saves with the signed-in user as creator", async () => {
    const response = await post({ workspaceId: WS_A, lane: "seo", title: "Backlinks", blocks: [table] });
    expect(response.status).toBe(201);
    expect(store.rows.at(-1)).toMatchObject({ workspaceId: WS_A, createdBy: "user-a", lane: "seo" });
  });

  it("refuses a workspace the user does not own before touching the database", async () => {
    store.auth = { ok: false, status: 403, error: "forbidden" };
    const before = store.rows.length;
    expect((await post({ workspaceId: WS_B, lane: "gtm", title: "x", blocks: [table] })).status).toBe(403);
    expect((await GET(new Request(`http://test/api/workspace/artifacts?workspaceId=${WS_B}`))).status).toBe(403);
    const removed = await DELETE(new Request(`http://test/api/workspace/artifacts/${ART_B}?workspaceId=${WS_B}`, { method: "DELETE" }), { params: Promise.resolve({ id: ART_B }) });
    expect(removed.status).toBe(403);
    expect(store.rows).toHaveLength(before);
    expect(store.wheres).toEqual([]);
  });

  it("rejects invalid blocks and lanes", async () => {
    expect((await post({ workspaceId: WS_A, lane: "seo", title: "x", blocks: [{ type: "chart" }] })).status).toBe(400);
    expect((await post({ workspaceId: WS_A, lane: "ads", title: "x", blocks: [table] })).status).toBe(400);
  });

  it("returns 404 when deleting another workspace's artifact through an owned workspace", async () => {
    const response = await DELETE(new Request(`http://test/api/workspace/artifacts/${ART_B}?workspaceId=${WS_A}`, { method: "DELETE" }), { params: Promise.resolve({ id: ART_B }) });
    expect(response.status).toBe(404);
    expect(store.rows.some((row) => row.id === ART_B)).toBe(true);
  });
});
