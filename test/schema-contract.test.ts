import { getTableColumns } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  document,
  semanticShadow,
  sourceTypeEnum,
  workspace,
} from "../lib/db/schema";

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
