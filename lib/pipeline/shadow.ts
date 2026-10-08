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
    await embedPendingDocuments(workspaceId, { limit: STAGE_DOC_LIMIT, signal });
    const stageDocs = docs.slice(0, STAGE_DOC_LIMIT);
    if (stageDocs.length === 0) return { signals: new Map(), vectors: new Map() };

    // Embedded directly from the document text rather than read back from Vectorize.
    const vectors = await embedTexts(
      stageDocs.map((doc) => doc.text),
      { workspaceId, sourceKey: "semantic-shadow", signal },
    );
    if (vectors === null) return null;

    const embedded = stageDocs.flatMap((doc, i) =>
      vectors[i].length > 0 ? [{ id: doc.id, vector: vectors[i] }] : [],
    );
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
