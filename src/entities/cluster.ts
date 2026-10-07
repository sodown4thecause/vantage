// ---------------------------------------------------------------------------
// Cross-source clustering (pure).
//
// GOAL: the same article widely echoed across sources (Google News + vendor blog
// + HN) should surface as ONE canonical signal with N sources — the "multi-source
// echo" collapse the product needs.
//
// SAFETY: matching on `global_title_hash` alone can OVER-MERGE. Two outlets can
// syndicate an identical headline for genuinely different stories, and wire
// copy/aggregators repeat headlines verbatim. So clustering is a NON-DESTRUCTIVE
// HINT, never a delete:
//
//   - Rows are never removed or merged in place. Each keeps its own id.
//   - A cluster is only formed when the SAME `global_title_hash` appears across
//     at least `minDistinctSources` DISTINCT source ids. Same-source repeats are
//     already handled by per-source dedup and do not count toward a cluster.
//   - Each cluster carries a `confidence` derived from how many distinct sources
//     corroborate it, plus the explicit list of source ids. The product decides
//     what to show; we only assert "these are likely the same story".
//
// This module is pure: it takes rows, returns grouping decisions. Persistence is
// in `src/db.ts` (`saveClusters`).
// ---------------------------------------------------------------------------

/** A row as far as clustering cares. */
export interface ClusterableItem {
  readonly id: number;
  readonly sourceId: string;
  /** Unscoped sha-256 of the normalized title. Null/empty rows never cluster. */
  readonly globalTitleHash: string | null;
}

/** One proposed cluster: the anchor item plus its corroborating members. */
export interface ClusterHint {
  /** Stable cluster key = the shared `global_title_hash`. */
  readonly key: string;
  /** The item chosen as canonical anchor (lowest id, deterministic). */
  readonly anchorId: number;
  /** All member ids, including the anchor, ascending. */
  readonly memberIds: ReadonlyArray<number>;
  /** Distinct source ids represented in the cluster, sorted. */
  readonly sourceIds: ReadonlyArray<string>;
  /** 0..1 confidence: more distinct sources => higher confidence, capped. */
  readonly confidence: number;
}

export interface ClusterOptions {
  /** Minimum distinct sources required to form a cluster. Default 2. */
  readonly minDistinctSources?: number;
}

/** Confidence curve: 1 source = 0 (never clusters), 2 = 0.6, 3 = 0.8, 4+ = 0.9. */
function confidenceFor(sourceCount: number): number {
  if (sourceCount <= 1) return 0;
  if (sourceCount === 2) return 0.6;
  if (sourceCount === 3) return 0.8;
  return 0.9;
}

/**
 * Group items by `global_title_hash` into non-destructive cluster hints.
 *
 * Deterministic: groups are keyed by hash, members sorted ascending by id, and
 * the anchor is the lowest id. Only hashes spanning >= `minDistinctSources`
 * distinct sources become clusters; everything else is omitted (each item stands
 * alone). Pure — returns a new array, mutates nothing.
 */
export function clusterByGlobalTitleHash(
  items: ReadonlyArray<ClusterableItem>,
  options: ClusterOptions = {},
): ReadonlyArray<ClusterHint> {
  const minDistinctSources = options.minDistinctSources ?? 2;

  // Bucket ids + source ids by hash, skipping rows with no usable hash.
  const groups = new Map<string, { ids: number[]; sourceIds: Set<string> }>();
  for (const item of items) {
    if (item.globalTitleHash === null || item.globalTitleHash === "") continue;
    const bucket = groups.get(item.globalTitleHash) ?? { ids: [], sourceIds: new Set<string>() };
    bucket.ids.push(item.id);
    bucket.sourceIds.add(item.sourceId);
    groups.set(item.globalTitleHash, bucket);
  }

  const hints: ClusterHint[] = [];
  for (const [key, bucket] of groups) {
    // A single source repeating a headline is *not* a cross-source echo: that is
    // per-source dedup territory and must never be labelled a cluster.
    if (bucket.sourceIds.size < minDistinctSources) continue;
    const memberIds = [...bucket.ids].sort((a, b) => a - b);
    const sourceIds = [...bucket.sourceIds].sort();
    const anchorId = memberIds[0] as number;
    hints.push({
      key,
      anchorId,
      memberIds,
      sourceIds,
      confidence: confidenceFor(sourceIds.length),
    });
  }

  // Stable output order for reproducible persistence.
  hints.sort((a, b) => a.key.localeCompare(b.key));
  return hints;
}

// ---------------------------------------------------------------------------
// Membership lifecycle (pure).
//
// The clustering window slides (`order by id desc limit 2000`). A cluster that
// was emitted yesterday can stop being emitted today, yet its member items keep
// a stale `cluster_id` pointing at an echo that no longer has >= 2 distinct
// sources. Persistence must therefore reconcile the CURRENT membership against
// what is stamped, not merely add to it. These helpers compute that delta purely,
// so the decision is unit-testable without a database.
//
// NOTE: these helpers are a SPECIFICATION/regression pin, not the executed code
// path. The production reconciliation is the set-based SQL in `src/db.ts`
// (`saveClusters` steps 3–5); this module documents the intended delta so smoke
// tests can pin it. The SQL itself is covered only by integration tests.
// ---------------------------------------------------------------------------

/** The set of item ids currently corroborated by any emitted cluster. */
export function currentClusterMemberIds(
  hints: ReadonlyArray<ClusterHint>,
): ReadonlySet<number> {
  const members = new Set<number>();
  for (const hint of hints) {
    for (const id of hint.memberIds) members.add(id);
  }
  return members;
}

/**
 * Given the cluster keys that were previously emitted (i.e. the live `clusters`
 * rows) and the current hints, split the keys into those still live and those
 * that have stopped being emitted.
 *
 * `deactivatedKeys` are the rows to stamp `inactive_since`; a key present again
 * in `currentKeys` is reactivated (its `inactive_since` cleared).
 */
export function clusterLifecycle(
  previouslyEmittedKeys: ReadonlyArray<string>,
  currentHints: ReadonlyArray<ClusterHint>,
): { readonly activeKeys: ReadonlyArray<string>; readonly deactivatedKeys: ReadonlyArray<string> } {
  const currentKeys = new Set(currentHints.map((h) => h.key));
  const previousKeys = new Set(previouslyEmittedKeys);
  const activeKeys = [...currentKeys].sort();
  const deactivatedKeys = [...previousKeys].filter((key) => !currentKeys.has(key)).sort();
  return { activeKeys, deactivatedKeys };
}
