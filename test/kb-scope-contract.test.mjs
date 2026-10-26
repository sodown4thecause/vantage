import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const ddl = read("../docs/superpowers/specs/2026-10-23-neon-knowledge-base-schema.sql");
const spec = read("../docs/superpowers/specs/2026-10-23-neon-knowledge-base-design.md");
const schema = read("../lib/db/schema.ts");
const drizzleDirectory = fileURLToPath(new URL("../drizzle", import.meta.url));
const drizzleSql = readdirSync(drizzleDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
  .map((entry) => readFileSync(join(drizzleDirectory, entry.name), "utf8"))
  .join("\n");
const kbDefinition =
  /\bCREATE\s+(?:TABLE|TYPE)\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:"[^"]+"|[a-z_][\w$]*)\.)?(?:"kb_(?:documents|chunks|tier|hub|scope)"|kb_(?:documents|chunks|tier|hub|scope))(?![\w$])/i;

const scopeCheck = ddl
  .split("\n")
  .find((line) => line.includes("CONSTRAINT kb_documents_scope_workspace_check"))
  .trim()
  .replace("CONSTRAINT kb_documents_scope_workspace_check CHECK ", "");

const readBoundary = spec
  .match(/```sql\n(SELECT id FROM kb_documents[\s\S]*?)```/)[1]
  .replaceAll("$1", "?");

const openScopedTable = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE kb_documents (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    approved BOOLEAN NOT NULL,
    workspace_id TEXT,
    CONSTRAINT kb_documents_scope_workspace_check CHECK ${scopeCheck}
  )`);
  return db;
};

describe("KB scope constraint", () => {
  it("accepts approved global rows without a workspace and private rows with one", () => {
    const db = openScopedTable();
    const insert = db.prepare("INSERT INTO kb_documents (id, scope, approved, workspace_id) VALUES (?, ?, ?, ?)");
    insert.run("global-approved", "global", 1, null);
    insert.run("private-approved", "private", 1, "w1");
    insert.run("private-unapproved", "private", 0, "w1");
    expect(db.prepare("SELECT COUNT(*) AS n FROM kb_documents").get().n).toBe(3);
  });

  it("rejects global rows with a workspace, unapproved global rows and private rows without a workspace", () => {
    const db = openScopedTable();
    const insert = db.prepare("INSERT INTO kb_documents (id, scope, approved, workspace_id) VALUES (?, ?, ?, ?)");
    expect(() => insert.run("global-with-workspace", "global", 1, "w1")).toThrow(/CHECK constraint failed/);
    expect(() => insert.run("global-unapproved", "global", 0, null)).toThrow(/CHECK constraint failed/);
    expect(() => insert.run("private-without-workspace", "private", 1, null)).toThrow(/CHECK constraint failed/);
  });
});

describe("KB read boundary", () => {
  it("returns only approved rows the authorised workspace may read", () => {
    const db = openScopedTable();
    const insert = db.prepare("INSERT INTO kb_documents (id, scope, approved, workspace_id) VALUES (?, ?, ?, ?)");
    insert.run("global-approved", "global", 1, null);
    insert.run("private-w1-approved", "private", 1, "w1");
    insert.run("private-w1-unapproved", "private", 0, "w1");
    insert.run("private-w2-approved", "private", 1, "w2");
    const visible = (workspace) =>
      db.prepare(readBoundary).all(workspace).map((row) => row.id);
    expect(visible("w1")).toEqual(["global-approved", "private-w1-approved"]);
    expect(visible("w2")).toEqual(["global-approved", "private-w2-approved"]);
    expect(visible("w3")).toEqual(["global-approved"]);
  });
});

describe("PostgreSQL design artifact", () => {
  it("declares built-in full-text search and halfvec embeddings without any extension", () => {
    expect(ddl).not.toMatch(/CREATE EXTENSION/i);
    expect(ddl).not.toMatch(/pg_search|bm25/i);
    expect(ddl).toContain(
      "tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(header, '') || ' ' || text)) STORED NOT NULL",
    );
    expect(ddl).toContain("CREATE INDEX kb_chunks_tsv_gin_idx ON kb_chunks USING gin (tsv);");
    expect(ddl).toContain("embedding halfvec(1024)");
    expect(ddl).toContain(
      "CREATE INDEX kb_chunks_embedding_hnsw_idx ON kb_chunks USING hnsw (embedding halfvec_cosine_ops);",
    );
  });

  it("recognises KB definitions in SQL regardless of the migration filename", () => {
    expect(kbDefinition.test('CREATE TABLE "public"."kb_documents" (...)')).toBe(true);
    expect(kbDefinition.test("CREATE TYPE another_schema.kb_scope AS ENUM (...)")).toBe(true);
    expect(kbDefinition.test("CREATE TABLE public.accounts (...)")).toBe(false);
  });

  it("keeps KB table and type definitions out of the executable schema and migration SQL", () => {
    expect(schema).not.toMatch(/\bkb_(?:documents|chunks|tier|hub|scope)\b/i);
    expect(drizzleSql).not.toMatch(kbDefinition);
  });
});
