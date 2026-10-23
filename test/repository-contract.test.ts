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

  it("declares the knowledge-base extensions before extension-backed indexes", () => {
    const journal = JSON.parse(read("drizzle/meta/_journal.json")) as {
      entries: Array<{ tag: string }>;
    };
    const migration = read(`drizzle/${journal.entries.at(-1)?.tag}.sql`);
    const vector = migration.indexOf("CREATE EXTENSION IF NOT EXISTS vector VERSION '0.8.6';");
    const search = migration.indexOf("CREATE EXTENSION IF NOT EXISTS pg_search;");

    expect(vector).toBeGreaterThanOrEqual(0);
    expect(search).toBeGreaterThan(vector);
    expect(search).toBeLessThan(migration.indexOf('CREATE TYPE "public"."kb_hub"'));
    expect(migration).toContain('CREATE INDEX "kb_chunks_bm25_idx"');
    expect(migration).toContain('CREATE INDEX "kb_chunks_embedding_hnsw_idx"');
  });
});
