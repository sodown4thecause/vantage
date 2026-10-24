import { getTableColumns } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  document,
  kbChunk,
  kbDocument,
  kbHubEnum,
  kbScopeEnum,
  kbTierEnum,
  semanticShadow,
  sourceTypeEnum,
  workspace,
} from "../lib/db/schema";

describe("knowledge base database contract", () => {
  it("keeps global and workspace documents distinct and filterable", () => {
    const columns = getTableColumns(kbDocument);
    expect(columns.workspaceId.notNull).toBe(false);
    expect(columns.sourceUrl.notNull).toBe(true);
    expect(columns.contentHash.notNull).toBe(true);
    expect(kbTierEnum.enumValues).toEqual(["A", "B", "C", "D"]);
    expect(kbHubEnum.enumValues).toEqual([
      "gtm",
      "seo-geo",
      "content",
      "coding",
      "community-rules",
    ]);

    const indexes = getTableConfig(kbDocument).indexes;
    expect(indexes.map((candidate) => candidate.config.name)).toEqual(
      expect.arrayContaining([
        "kb_documents_workspace_hub_published_idx",
        "kb_documents_workspace_source_idx",
      ]),
    );
  });

  it("requires private documents to be workspace-scoped and global documents approved", () => {
    expect(kbScopeEnum.enumValues).toEqual(["global", "private"]);
    const columns = getTableColumns(kbDocument);
    expect(columns.scope.notNull).toBe(true);
    expect(columns.approved.notNull).toBe(true);
    expect(columns.workspaceId.notNull).toBe(false);

    const constraint = getTableConfig(kbDocument).checks.find(
      (candidate) => candidate.name === "kb_documents_scope_workspace_check",
    );
    expect(constraint).toBeDefined();
    const predicate = constraint ? new PgDialect().sqlToQuery(constraint.value).sql : "";
    expect(predicate).toContain('"scope" = \'global\'');
    expect(predicate).toContain('"workspace_id" is null');
    expect(predicate).toContain('"approved"');
    expect(predicate).toContain('"scope" = \'private\'');
    expect(predicate).toContain('"workspace_id" is not null');
  });

  it("stores ordered half-precision chunks with vector and BM25 indexes", () => {
    const columns = getTableColumns(kbChunk);
    expect(columns.embedding.getSQLType()).toBe("halfvec(1024)");
    expect(columns.embedding.notNull).toBe(false);
    expect(columns.tsv.getSQLType()).toBe("tsvector");
    expect(columns.chunkerVersion.notNull).toBe(true);
    expect(columns.contentHash.notNull).toBe(true);

    const indexes = getTableConfig(kbChunk).indexes;
    const byName = (name: string) => indexes.find((candidate) => candidate.config.name === name);
    const ordered = byName("kb_chunks_document_ord_uidx");
    expect(ordered?.config.unique).toBe(true);
    expect(ordered?.config.columns.map((column) => (column as { name?: string }).name)).toEqual([
      "document_id",
      "ord",
    ]);

    const hnsw = byName("kb_chunks_embedding_hnsw_idx");
    expect(hnsw?.config.method).toBe("hnsw");
    expect((hnsw?.config.columns[0] as { indexConfig?: { opClass?: string } }).indexConfig?.opClass).toBe(
      "halfvec_cosine_ops",
    );

    const bm25 = byName("kb_chunks_bm25_idx");
    expect(bm25?.config.method).toBe("bm25");
    expect(bm25?.config.with).toEqual({ key_field: "'id'" });
    expect(bm25?.config.columns.map((column) => (column as { name?: string }).name)).toEqual([
      "id",
      "header",
      "text",
    ]);
  });
});

describe("M1 database contract", () => {
  it("accepts every M1 collector source type", () => {
    expect(sourceTypeEnum.enumValues).toEqual(
      expect.arrayContaining([
        "hn",
        "rss",
        "substack",
        "producthunt",
        "youtube",
        "reddit",
        "x",
      ]),
    );
  });

  it("stores Neon Auth user ids as text", () => {
    expect(getTableColumns(workspace).ownerUserId.getSQLType()).toBe("text");
  });

  it("tracks embedding state on document rows", () => {
    const columns = getTableColumns(document);
    expect(columns.embeddingModel.getSQLType()).toBe("text");
    expect(columns.embeddingModel.notNull).toBe(false);
    expect(columns.embeddedAt.getSQLType()).toBe("timestamp with time zone");
    expect(columns.embeddedAt.notNull).toBe(false);
  });

  it("partially indexes unembedded documents per workspace", () => {
    const index = getTableConfig(document).indexes.find(
      (candidate) => candidate.config.name === "document_unembedded_idx",
    );
    expect(index).toBeDefined();
    const keys = (index?.config.columns ?? []).map((column) => (column as { name?: string }).name);
    expect(keys).toContain("workspace_id");
    const predicate = index?.config.where ? new PgDialect().sqlToQuery(index.config.where).sql : "";
    expect(predicate).toContain('"embedded_at" is null');
  });

  it("creates a semantic shadow table keyed uniquely by document and mode", () => {
    const columns = getTableColumns(semanticShadow);
    expect(Object.keys(columns)).toEqual(
      expect.arrayContaining([
        "id",
        "workspaceId",
        "documentId",
        "keywordRung",
        "semanticRung",
        "semanticFit",
        "anchorSimilarity",
        "mode",
        "createdAt",
      ]),
    );
    expect(columns.keywordRung.notNull).toBe(true);
    expect(columns.semanticRung.notNull).toBe(false);
    expect(columns.semanticFit.getSQLType()).toBe("real");
    expect(columns.anchorSimilarity.getSQLType()).toBe("real");

    const config = getTableConfig(semanticShadow);
    const unique = config.indexes.find(
      (candidate) => candidate.config.name === "semantic_shadow_document_mode_uidx",
    );
    expect(unique?.config.unique).toBe(true);
    expect(unique?.config.columns.map((column) => (column as { name: string }).name)).toEqual([
      "document_id",
      "mode",
    ]);
  });
});
