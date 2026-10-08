import { mapWithConcurrency } from "@/lib/async/map-with-concurrency";
import { EMBEDDING_DIMENSIONS, embedTexts } from "@/lib/embeddings/embed";
import { isVectorizeAvailable, queryVectors } from "@/lib/embeddings/store";
import { ANCHORS } from "@/lib/pipeline/anchors";

/** Provisional; calibrated in Task 8. */
export const SEMANTIC_THRESHOLDS = { anchor: 0.6, fit: 0.5, duplicate: 0.92 } as const;

/** Profile vectors fetched per document when computing fit. */
const PROFILE_TOP_K = 3;
/** Concurrent Vectorize queries per semanticSignals call. */
const QUERY_CONCURRENCY = 4;

export type SemanticSignal = {
  documentId: string;
  fit: number;
  rung: number | null;
  anchorSimilarity: number | null;
};

export type AnchorVector = { rung: number; values: number[] };

/** Cosine similarity. Returns 0 when either vector is all zeros; throws on length mismatch. */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error("cosine requires vectors of equal length");
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** In-flight or settled anchor embedding. Cleared on failure so a later call can retry. */
let anchorMemo: Promise<AnchorVector[] | null> | null = null;

async function embedAnchors(): Promise<AnchorVector[] | null> {
  const vectors = await embedTexts(
    ANCHORS.map((anchor) => anchor.text),
    { sourceKey: "semantic-anchors" },
  );
  if (vectors === null) return null;
  const out: AnchorVector[] = [];
  for (let i = 0; i < ANCHORS.length; i++) {
    const values = vectors[i];
    if (values.length !== EMBEDDING_DIMENSIONS) return null;
    out.push({ rung: ANCHORS[i].rung, values });
  }
  return out;
}

/**
 * Anchor vectors, embedded once per module instance. Resolves null when the AI
 * binding is absent or the embedding call fails; failures are not memoised.
 */
export function loadAnchorVectors(): Promise<AnchorVector[] | null> {
  if (anchorMemo === null) {
    anchorMemo = embedAnchors().then((vectors) => {
      if (vectors === null) anchorMemo = null;
      return vectors;
    });
  }
  return anchorMemo;
}

async function signalFor(
  workspaceId: string,
  doc: { id: string; vector: number[] },
  anchors: AnchorVector[],
): Promise<SemanticSignal | null> {
  if (doc.vector.length !== EMBEDDING_DIMENSIONS) {
    return { documentId: doc.id, fit: 0, rung: null, anchorSimilarity: null };
  }

  let nearest: AnchorVector | null = null;
  let anchorSimilarity = -Infinity;
  for (const anchor of anchors) {
    const similarity = cosine(doc.vector, anchor.values);
    if (similarity > anchorSimilarity) {
      anchorSimilarity = similarity;
      nearest = anchor;
    }
  }
  const rung =
    nearest !== null && anchorSimilarity >= SEMANTIC_THRESHOLDS.anchor ? nearest.rung : null;

  // null means Vectorize failed or is absent: no fit signal for this document, not a fit of 0.
  const matches = await queryVectors(workspaceId, doc.vector, { kind: "profile", topK: PROFILE_TOP_K });
  if (matches === null) return null;
  const fit = matches.length === 0 ? 0 : Math.max(...matches.map((match) => match.score));

  return {
    documentId: doc.id,
    fit,
    rung,
    anchorSimilarity: nearest === null ? null : anchorSimilarity,
  };
}

/**
 * Semantic signals for documents already embedded by the caller. `fit` is the
 * best cosine to this workspace's profile vectors; `rung` and `anchorSimilarity`
 * come from the nearest anchor, with rung null below SEMANTIC_THRESHOLDS.anchor.
 * Returns null when anchor embedding or Vectorize is unavailable, so the caller keeps
 * keyword-only scoring. Never throws for AI or Vectorize failures.
 */
export async function semanticSignals(
  workspaceId: string,
  docs: Array<{ id: string; vector: number[] }>,
): Promise<Map<string, SemanticSignal> | null> {
  // Without Vectorize there is no fit signal; stay keyword-only rather than emit half a signal.
  if (!(await isVectorizeAvailable())) return null;
  const anchors = await loadAnchorVectors();
  if (anchors === null) return null;
  const signals = await mapWithConcurrency(docs, QUERY_CONCURRENCY, (doc) =>
    signalFor(workspaceId, doc, anchors),
  );
  // One failed Vectorize query makes the stage unavailable: partial fit data would bias "on" scoring.
  const resolved: SemanticSignal[] = [];
  for (const signal of signals) {
    if (signal === null) return null;
    resolved.push(signal);
  }
  return new Map(resolved.map((signal) => [signal.documentId, signal]));
}
