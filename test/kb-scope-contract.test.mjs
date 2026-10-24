import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { kbDocument } from "../lib/db/schema";

const constraint = getTableConfig(kbDocument).checks.find(
  (candidate) => candidate.name === "kb_documents_scope_workspace_check",
);
const predicate = new PgDialect().sqlToQuery(constraint.value).sql;
const spec = readFileSync(
  new URL("../docs/superpowers/specs/2026-10-23-neon-knowledge-base-design.md", import.meta.url),
  "utf8",
);
const readContract = spec.match(/```sql\n([\s\S]*?)\n```/)[1];

describe("KB scope SQL contracts (in-memory SQLite, not a runtime reader)", () => {
  it.each([
    ["private", "synthetic-workspace-a", 0, true],
    ["private", "synthetic-workspace-a", 1, true],
    ["private", null, 0, false],
    ["private", null, 1, false],
    ["global", null, 1, true],
    ["global", null, 0, false],
    ["global", "synthetic-workspace-a", 0, false],
    ["global", "synthetic-workspace-a", 1, false],
    [null, "synthetic-workspace-a", 1, false],
    ["private", "synthetic-workspace-a", null, false],
  ])("scope=%s workspace=%s approved=%s accepted=%s", (scope, workspaceId, approved, accepted) => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`CREATE TABLE kb_documents (
        scope TEXT NOT NULL,
        workspace_id TEXT,
        approved INTEGER NOT NULL,
        CHECK (${predicate})
      )`);
      const insert = () => db.prepare("INSERT INTO kb_documents VALUES (?, ?, ?)")
        .run(scope, workspaceId, approved);
      if (accepted) expect(insert).not.toThrow();
      else expect(insert).toThrow(/constraint failed/i);
    } finally {
      db.close();
    }
  });

  it("limits the proposed reader to approved globals and the authorised workspace", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`CREATE TABLE kb_documents (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        workspace_id TEXT,
        approved INTEGER NOT NULL,
        CHECK (${predicate})
      )`);
      const insert = db.prepare("INSERT INTO kb_documents VALUES (?, ?, ?, ?)");
      insert.run("global-approved", "global", null, 1);
      insert.run("private-a-approved", "private", "synthetic-workspace-a", 1);
      insert.run("private-a-proposed", "private", "synthetic-workspace-a", 0);
      insert.run("private-b-approved", "private", "synthetic-workspace-b", 1);
      insert.run("private-b-proposed", "private", "synthetic-workspace-b", 0);

      const ids = (workspaceId) => db.prepare(readContract)
        .all({ "$1": workspaceId }).map((row) => row.id);
      expect(ids("synthetic-workspace-a")).toEqual(["global-approved", "private-a-approved"]);
      expect(ids("synthetic-workspace-b")).toEqual(["global-approved", "private-b-approved"]);
      expect(ids("synthetic-workspace-c")).toEqual(["global-approved"]);
      expect(ids(null)).toEqual(["global-approved"]);
      expect(ids("synthetic-workspace-a' OR 1=1 --")).toEqual(["global-approved"]);
    } finally {
      db.close();
    }
  });
});
