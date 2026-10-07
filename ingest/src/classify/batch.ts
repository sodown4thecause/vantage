// ---------------------------------------------------------------------------
// Batch assembly + reconciliation (pure).
//
// Two responsibilities, both testable without any I/O:
//   1. chunkItems   — split a list into fixed-size batches (+ cap total).
//   2. reconcile    — map LLM classifications back onto input items by index,
//                     detecting duplicates/out-of-range/missing, and producing a
//                     per-item result where unanswerable items become a
//                     well-formed `unclassified` fallback (never a crash).
// ---------------------------------------------------------------------------
import type { ClassificationItem, SignalLabel } from "./schema";

/** The minimal item shape the classifier needs. Kept narrow on purpose. */
export interface ClassificationInputItem {
  readonly id: number;
  readonly sourceName: string;
  readonly title: string;
  readonly summary: string | null;
  readonly rawContent: string;
}

/** A classified result ready to persist. `status` distinguishes success/fallback. */
export interface ReconciledItem {
  readonly id: number;
  readonly status: "classified" | "unclassified";
  readonly labels: ReadonlyArray<SignalLabel>;
  readonly entities: ReadonlyArray<string>;
  readonly relevance: number;
  readonly reason: string;
  readonly uncertain: ReadonlyArray<SignalLabel>;
}

/** Split items into batches of at most `batchSize`, never exceeding `maxItems`. */
export function chunkItems<T>(
  items: ReadonlyArray<T>,
  batchSize: number,
  maxItems: number,
): ReadonlyArray<ReadonlyArray<T>> {
  if (batchSize <= 0) throw new Error(`batchSize must be > 0, got ${batchSize}`);
  const capped = items.slice(0, Math.max(0, maxItems));
  const batches: T[][] = [];
  for (let i = 0; i < capped.length; i += batchSize) {
    batches.push(capped.slice(i, i + batchSize));
  }
  return batches;
}

/** The fallback result for an item the model did not (validly) classify. */
export function unclassified(id: number, reason: string): ReconciledItem {
  return {
    id,
    status: "unclassified",
    labels: [],
    entities: [],
    relevance: 0,
    reason,
    uncertain: [],
  };
}

/**
 * Map classifications back onto input items by their reported `index`.
 *
 * - Out-of-range indices are ignored (the model cannot reach an item that was
 *   not in its prompt).
 * - The first valid classification for an index wins; later duplicates are
 *   dropped (deterministic).
 * - Items with no valid classification become `unclassified` fallbacks.
 *
 * Pure: returns a new array aligned to `items`.
 */
export function reconcile(
  items: ReadonlyArray<ClassificationInputItem>,
  classifications: ReadonlyArray<ClassificationItem>,
): ReadonlyArray<ReconciledItem> {
  const byIndex = new Map<number, ClassificationItem>();
  for (const item of classifications) {
    if (item.index < 0 || item.index >= items.length) continue;
    if (!byIndex.has(item.index)) byIndex.set(item.index, item);
  }

  return items.map((item, index) => {
    const classified = byIndex.get(index);
    if (classified === undefined) {
      return unclassified(item.id, "model did not return a valid classification");
    }
    return {
      id: item.id,
      status: "classified",
      labels: dedupeLabels(classified.labels),
      entities: dedupeEntities(classified.entities),
      relevance: classified.relevance,
      reason: classified.reason,
      uncertain: dedupeLabels(classified.uncertain),
    };
  });
}

/**
 * Validate a repair reply's index set against the `missing` ordinals it was
 * asked to answer.
 *
 * The repair prompt renumbers items `0..missing.length-1`, and the caller maps
 * `missing[ordinal]` back to the original batch index. A misnumbered reply —
 * an ordinal equal to the ORIGINAL batch position, a duplicate ordinal, or an
 * extra value — would silently map a label onto the WRONG row, which is the
 * worst failure mode for a correctness-first product. So the reply is accepted
 * only when its reported index set is EXACTLY a subset of `{0..missing.length-1}`
 * with no duplicates and no extras.
 *
 * Returns true when it is safe to remap; false means "treat as a parse failure"
 * (the affected indices fall back to `unclassified`).
 */
export function isValidRepairIndexSet(
  items: ReadonlyArray<ClassificationItem>,
  missingCount: number,
): boolean {
  const seen = new Set<number>();
  for (const item of items) {
    if (!Number.isInteger(item.index)) return false;
    if (item.index < 0 || item.index >= missingCount) return false;
    if (seen.has(item.index)) return false;
    seen.add(item.index);
  }
  return true;
}

/** Indices (into `items`) that did NOT receive a valid classification. */
export function missingIndices(
  items: ReadonlyArray<ClassificationInputItem>,
  classifications: ReadonlyArray<ClassificationItem>,
): ReadonlyArray<number> {
  const valid = new Set<number>();
  for (const item of classifications) {
    if (item.index >= 0 && item.index < items.length) valid.add(item.index);
  }
  const missing: number[] = [];
  for (let i = 0; i < items.length; i += 1) {
    if (!valid.has(i)) missing.push(i);
  }
  return missing;
}

/** Stable de-dup of labels, preserving first-seen order. */
function dedupeLabels(labels: ReadonlyArray<SignalLabel>): ReadonlyArray<SignalLabel> {
  return [...new Set(labels)];
}

/**
 * Stable de-dup of entity mentions, case-insensitively, trimmed. Empty strings
 * are dropped. Canonicalization to entities happens later, in `src/entities`.
 */
function dedupeEntities(entities: ReadonlyArray<string>): ReadonlyArray<string> {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of entities) {
    const trimmed = raw.trim();
    if (trimmed === "") continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}
