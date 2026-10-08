import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

type FakeRow = {
  id: string;
  workspaceId: string;
  urlCanonical: string;
  platform: string;
  title: string | null;
  contentMd: string;
  authorRef: string | null;
  postedAt: Date | null;
  contentHash: string;
  collectedAt: Date;
  embeddingModel: string | null;
  embeddedAt: Date | null;
};

const state = vi.hoisted(() => ({
  rows: [] as FakeRow[],
  ai: null as unknown,
  vectorize: null as unknown,
  recorded: [] as Array<Record<string, unknown>>,
  selectSql: null as null | { where: string; order: string },
}));

// Params of a drizzle condition: workspace id and row ids are bound values, so
// reading them back keeps the fake honest about which rows a query targets.
function paramsOf(condition: unknown): unknown[] {
  return new PgDialect().sqlToQuery(condition as Parameters<PgDialect["sqlToQuery"]>[0]).params;
}

// Rendered SQL of a drizzle expression, so tests can assert the real predicate and ordering.
function sqlOf(expression: unknown): string {
  return new PgDialect().sqlToQuery(expression as Parameters<PgDialect["sqlToQuery"]>[0]).sql;
}

vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: (condition: unknown) => ({
          orderBy: (order: unknown) => ({
            limit: async (n: number) => {
              const params = paramsOf(condition);
              state.selectSql = { where: sqlOf(condition), order: sqlOf(order) };
              return state.rows
                .filter((r) => r.embeddedAt === null && params.includes(r.workspaceId))
                .sort((a, b) => b.collectedAt.getTime() - a.collectedAt.getTime())
                .slice(0, n)
                .map((r) => ({ ...r }));
            },
          }),
        }),
      }),
    }),
    update: () => ({
      set: (values: Partial<FakeRow>) => ({
        where: async (condition: unknown) => {
          const params = paramsOf(condition);
          for (const row of state.rows) {
            if (params.includes(row.id) && params.includes(row.workspaceId)) Object.assign(row, values);
          }
        },
      }),
    }),
  }),
}));

vi.mock("@/lib/cf/env", () => ({
  getAi: async () => state.ai,
  getVectorize: async () => state.vectorize,
}));
vi.mock("@/lib/costs/ledger", () => ({
  recordCost: async (input: Record<string, unknown>) => {
    state.recorded.push(input);
    return true;
  },
}));
vi.mock("@/lib/costs/prices", () => ({
  getUnitCost: async () => 0.0118,
}));

import { EMBEDDING_MODEL } from "@/lib/embeddings/embed";
import { embedPendingDocuments } from "@/lib/embeddings/index-documents";
import { createFakeAi, fakeVector } from "./helpers/fake-ai";
import { createFakeVectorize } from "./helpers/fake-vectorize";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function row(overrides: Partial<FakeRow> & { id: string }): FakeRow {
  return {
    workspaceId: WORKSPACE,
    urlCanonical: `https://example.com/${overrides.id}`,
    platform: "hn",
    title: "Title",
    contentMd: "Body text",
    authorRef: null,
    postedAt: new Date("2026-10-01T12:00:00Z"),
    contentHash: `hash-${overrides.id}`,
    collectedAt: new Date("2026-10-07T00:00:00Z"),
    embeddingModel: null,
    embeddedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  state.rows = [];
  state.ai = null;
  state.vectorize = null;
  state.recorded = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("embedPendingDocuments", () => {
  it("embeds pending documents, upserts doc vectors and marks rows embedded", async () => {
    const ai = createFakeAi();
    const vz = createFakeVectorize();
    state.ai = ai.binding;
    state.vectorize = vz.binding;
    state.rows = [row({ id: "d1", title: "Alpha", contentMd: "first" })];

    const result = await embedPendingDocuments(WORKSPACE, { limit: 10 });

    expect(result).toMatchObject({ embedded: 1 });
    expect(ai.calls[0].text).toEqual(["Alpha first"]);
    const stored = vz.store.get("doc:d1");
    expect(stored?.values).toEqual(fakeVector("Alpha first"));
    expect(stored?.namespace).toBe(WORKSPACE);
    expect(stored?.metadata).toEqual({ kind: "doc", platform: "hn", postedAt: Date.parse("2026-10-01T12:00:00Z") });
    expect(state.rows[0].embeddingModel).toBe(EMBEDDING_MODEL);
    expect(state.rows[0].embeddedAt).toBeInstanceOf(Date);
  });

  it("selects unembedded rows of the workspace, newest first", async () => {
    const ai = createFakeAi();
    const vz = createFakeVectorize();
    state.ai = ai.binding;
    state.vectorize = vz.binding;
    state.rows = [row({ id: "sql-check" })];
    state.selectSql = null;

    await embedPendingDocuments(WORKSPACE, { limit: 10 });

    // Read through a cast: the reset above narrows the property to null for the compiler.
    const captured = state.selectSql as null | { where: string; order: string };
    expect(captured?.where).toContain('"embedded_at" is null');
    expect(captured?.where).toContain('"workspace_id" = ');
    expect(captured?.order).toContain('"collected_at" desc');
  });

  it("marks empty-text documents embedded without calling the AI or writing a vector", async () => {
    const ai = createFakeAi();
    const vz = createFakeVectorize();
    state.ai = ai.binding;
    state.vectorize = vz.binding;
    state.rows = [row({ id: "blank", title: null, contentMd: "   <br>  " })];

    const result = await embedPendingDocuments(WORKSPACE, { limit: 10 });

    expect(result).toMatchObject({ embedded: 0 });
    expect(ai.calls).toHaveLength(0);
    expect(vz.calls).toHaveLength(0);
    expect(state.rows[0].embeddedAt).toBeInstanceOf(Date);
  });

  it("is a no-op returning skipped unavailable when embedding is unavailable, leaving rows pending", async () => {
    const vz = createFakeVectorize();
    state.vectorize = vz.binding;
    state.rows = [row({ id: "d1" })];

    const result = await embedPendingDocuments(WORKSPACE, { limit: 10 });

    expect(result).toMatchObject({ embedded: 0, skipped: "unavailable" });
    expect(vz.calls).toHaveLength(0);
    expect(state.rows[0].embeddedAt).toBeNull();
    expect(state.rows[0].embeddingModel).toBeNull();
  });

  it("is idempotent: a second run embeds nothing", async () => {
    const ai = createFakeAi();
    state.ai = ai.binding;
    state.vectorize = createFakeVectorize().binding;
    state.rows = [row({ id: "d1" }), row({ id: "d2", contentMd: "other" })];

    expect(await embedPendingDocuments(WORKSPACE, { limit: 10 })).toMatchObject({ embedded: 2 });
    expect(await embedPendingDocuments(WORKSPACE, { limit: 10 })).toMatchObject({ embedded: 0 });
    expect(ai.calls).toHaveLength(1);
  });

  it("only touches rows in the requested workspace", async () => {
    const ai = createFakeAi();
    state.ai = ai.binding;
    state.vectorize = createFakeVectorize().binding;
    state.rows = [row({ id: "mine" }), row({ id: "theirs", workspaceId: OTHER })];

    await embedPendingDocuments(WORKSPACE, { limit: 10 });

    expect(state.rows.find((r) => r.id === "mine")?.embeddedAt).toBeInstanceOf(Date);
    expect(state.rows.find((r) => r.id === "theirs")?.embeddedAt).toBeNull();
  });

  it("respects the limit, taking the most recently collected documents first", async () => {
    const ai = createFakeAi();
    state.ai = ai.binding;
    state.vectorize = createFakeVectorize().binding;
    state.rows = [
      row({ id: "old", collectedAt: new Date("2026-10-01T00:00:00Z"), contentMd: "old" }),
      row({ id: "new", collectedAt: new Date("2026-10-06T00:00:00Z"), contentMd: "new" }),
    ];

    expect(await embedPendingDocuments(WORKSPACE, { limit: 1 })).toMatchObject({ embedded: 1 });
    expect(state.rows.find((r) => r.id === "new")?.embeddedAt).toBeInstanceOf(Date);
    expect(state.rows.find((r) => r.id === "old")?.embeddedAt).toBeNull();
  });
});
