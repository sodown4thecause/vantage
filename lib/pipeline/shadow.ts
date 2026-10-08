import { and, eq, inArray } from "drizzle-orm";

import { getSemanticMode } from "@/lib/cf/env";
import { getDb } from "@/lib/db/client";
import { semanticShadow } from "@/lib/db/schema";
import { embedTexts } from "@/lib/embeddings/embed";
import { embedPendingDocuments } from "@/lib/embeddings/index-documents";
import { classifyIntent } from "@/lib/pipeline/intent-ladder";
import type { NormalizedDocument } from "@/lib/pipeline/normalize";
import { semanticSignals, type SemanticSignal } from "@/lib/pipeline/semantic";

/** Documents per build that are embedded and recorded; bounds AI spend per run. */
const STAGE_DOC_LIMIT = 200;

/** Documents that already have a shadow row for this mode. Their signals can never be stored again. */
async function recordedDocumentIds(workspaceId: string, mode: "shadow", documentIds: string[]): Promise<Set<string>> {
  if (documentIds.length === 0) return new Set();
  const rows = await getDb()
    .select({ documentId: semanticShadow.documentId })
    .from(semanticShadow)
    .where(and(
      eq(semanticShadow.workspaceId, workspaceId),
      eq(semanticShadow.mode, mode),
      inArray(semanticShadow.documentId, documentIds),
    ));
  return new Set(rows.map((row) => row.documentId));
}

/**
 * Inserts one shadow row per document: the keyword rung from the intent ladder
 * alongside the semantic values (null where the document has no signal). A
 * repeated (documentId, mode) pair is skipped, so re-running a build adds nothing.
 * Returns the number of rows actually inserted.
 */
export async function recordShadow(
  workspaceId: string,
  docs: NormalizedDocument[],
  signals: Map<string, SemanticSignal>,
  mode: "shadow" | "on",
): Promise<number> {
  if (docs.length === 0) return 0;
  const rows = docs.map((doc) => {
    const signal = signals.get(doc.id);
    return {
      workspaceId,
      documentId: doc.id,
      keywordRung: classifyIntent(doc).intentRung,
      semanticRung: signal?.rung ?? null,
      semanticFit: signal?.fit ?? null,
      anchorSimilarity: signal?.anchorSimilarity ?? null,
      mode,
    };
  });
  const inserted = await getDb()
    .insert(semanticShadow)
    .values(rows)
    .onConflictDoNothing({ target: [semanticShadow.documentId, semanticShadow.mode] })
    .returning({ id: semanticShadow.id });
  return inserted.length;
}

/** Signals plus the document vectors they were computed from, keyed by document id. */
export type SemanticStageResult = {
  signals: Map<string, SemanticSignal>;
  vectors: Map<string, number[]>;
};

/**
 * Runs semantic scoring beside the keyword pipeline. Off by default: with mode
 * "off" it returns null before any call. Otherwise it persists pending embeddings,
 * embeds this run's documents, computes signals and records shadow rows. Returns
 * the signals and the document vectors, or null when AI or Vectorize is unavailable.
 * The caller must not feed the result into scoring unless the mode is "on". Never throws.
 */
export async function runSemanticStageDetailed(
  workspaceId: string,
  docs: NormalizedDocument[],
  signal?: AbortSignal,
): Promise<SemanticStageResult | null> {
  const mode = getSemanticMode();
  if (mode === "off") return null;
  try {
    const indexed = await embedPendingDocuments(workspaceId, { limit: STAGE_DOC_LIMIT, signal });
    // Shadow signals never feed scoring, so re-scoring a recorded document only spends AI and Vectorize calls.
    // "on" mode still needs signals for every document, so it does not skip.
    let candidates = docs;
    if (mode === "shadow") {
      const recorded = await recordedDocumentIds(workspaceId, mode, docs.map((doc) => doc.id));
      candidates = docs.filter((doc) => !recorded.has(doc.id));
    }
    const stageDocs = candidates.slice(0, STAGE_DOC_LIMIT);
    if (stageDocs.length === 0) return { signals: new Map(), vectors: new Map() };

    // Reuse vectors computed while indexing this run's pending documents; embed only the rest.
    const vectorById = new Map(indexed.vectors);
    const missing = stageDocs.filter((doc) => !vectorById.has(doc.id));
    if (missing.length > 0) {
      const fresh = await embedTexts(
        missing.map((doc) => doc.text),
        { workspaceId, sourceKey: "semantic-shadow", signal },
      );
      if (fresh === null) return null;
      missing.forEach((doc, i) => vectorById.set(doc.id, fresh[i]));
    }

    const embedded = stageDocs.flatMap((doc) => {
      const vector = vectorById.get(doc.id) ?? [];
      return vector.length > 0 ? [{ id: doc.id, vector }] : [];
    });
    const signals = await semanticSignals(workspaceId, embedded);
    if (signals === null) return null;

    await recordShadow(workspaceId, stageDocs, signals, mode);
    return { signals, vectors: new Map(embedded.map((doc) => [doc.id, doc.vector])) };
  } catch (err) {
    // Only the error class is logged: messages can embed connection details.
    console.error("[semantic] shadow stage failed", {
      error: err instanceof Error ? err.name : "unknown",
    });
    return null;
  }
}

/** Signals only, for callers that do not need the vectors. Same contract as runSemanticStageDetailed. */
export async function runSemanticStage(
  workspaceId: string,
  docs: NormalizedDocument[],
  signal?: AbortSignal,
): Promise<Map<string, SemanticSignal> | null> {
  return (await runSemanticStageDetailed(workspaceId, docs, signal))?.signals ?? null;
}
