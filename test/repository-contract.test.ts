import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("repository delivery contract", () => {
  it("documents every M1 provider environment variable", () => {
    const envExample = read(".env.example");
    expect(envExample).toContain('PH_DEV_TOKEN=""');
    expect(envExample).toContain('YOUTUBE_API_KEY=""');
    expect(envExample).toContain('AI_GATEWAY_API_KEY=""');
    expect(envExample).toContain('TINYFISH_API_KEY=""');
    expect(envExample).toContain('SCAVIO_API_KEY=""');
  });

  it("limits drizzle-kit to the application-owned public schema", () => {
    expect(read("drizzle.config.ts")).toContain('schemaFilter: ["public"]');
  });

  it("commits migration snapshots for every journal entry", () => {
    const journal = JSON.parse(read("drizzle/meta/_journal.json")) as {
      entries: Array<{ idx: number }>;
    };

    for (const entry of journal.entries) {
      expect(() => read(`drizzle/meta/${String(entry.idx).padStart(4, "0")}_snapshot.json`)).not.toThrow();
    }
  });

  it("keeps the complete KB contract in one provisional generated migration without enabling extensions", () => {
    const journal = JSON.parse(read("drizzle/meta/_journal.json")) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    const kbMigrations = journal.entries.filter((entry) =>
      read(`drizzle/${entry.tag}.sql`).includes('CREATE TABLE "kb_documents"'),
    );
    expect(kbMigrations).toHaveLength(1);
    const entry = kbMigrations[0];
    const migration = read(`drizzle/${entry.tag}.sql`);

    expect(migration).not.toMatch(/CREATE EXTENSION/i);
    expect(migration).not.toContain('"tsv"');
    expect(migration).toContain('"embedding" halfvec(1024)');
    expect(migration).toContain('"scope" "kb_scope" DEFAULT \'private\' NOT NULL');
    expect(migration).toContain('"approved" boolean DEFAULT false NOT NULL');
    expect(migration).toContain('CONSTRAINT "kb_documents_scope_workspace_check" CHECK');
    expect(migration).toContain('CREATE INDEX "kb_chunks_bm25_idx"');
    expect(migration).toContain('CREATE INDEX "kb_chunks_embedding_hnsw_idx"');

    const snapshot = JSON.parse(read(`drizzle/meta/${String(entry.idx).padStart(4, "0")}_snapshot.json`));
    const previous = JSON.parse(read(`drizzle/meta/${String(entry.idx - 1).padStart(4, "0")}_snapshot.json`));
    expect(snapshot.prevId).toBe(previous.id);
    expect(snapshot.tables["public.kb_documents"].checkConstraints)
      .toHaveProperty("kb_documents_scope_workspace_check");
    expect(snapshot.tables["public.kb_chunks"].columns.embedding.type).toBe("halfvec(1024)");
  });
});
