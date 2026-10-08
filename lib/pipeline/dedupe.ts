import { queryVectors, type VectorMatch } from "@/lib/embeddings/store";
import { cosine, SEMANTIC_THRESHOLDS } from "@/lib/pipeline/semantic";

/** Vectorize allows topK up to 50 when metadata is returned, so olderNeighbours asks for the maximum. */
const NEIGHBOUR_TOP_K = 50;

export type DedupeItem = { id: string; vector: number[]; postedAt: number | null };

/** Earlier posting wins; undated items rank after dated ones; ties go to the smaller id. */
function precedes(a: DedupeItem, b: DedupeItem): boolean {
  const ta = a.postedAt ?? Number.POSITIVE_INFINITY;
  const tb = b.postedAt ?? Number.POSITIVE_INFINITY;
  if (ta !== tb) return ta < tb;
  return a.id < b.id;
}

/**
 * Maps each id to the canonical id of its near-duplicate group. Two items are linked
 * when their cosine is at least `threshold`; links are transitive (union-find). The
 * canonical member is the earliest posting, ties broken by id. Items with no neighbour
 * map to themselves. Pairs with mismatched vector lengths are never linked.
 */
export function nearDuplicates(
  items: DedupeItem[],
  threshold: number = SEMANTIC_THRESHOLDS.duplicate,
): Map<string, string> {
  const byId = new Map<string, DedupeItem>();
  for (const item of items) if (!byId.has(item.id)) byId.set(item.id, item);
  const unique = [...byId.values()];

  // Each root is the earliest member of its set, so the root is the canonical id.
  const parent = new Map<string, string>(unique.map((item) => [item.id, item.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = id;
    while (cur !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };

  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      const a = unique[i];
      const b = unique[j];
      if (a.vector.length === 0 || a.vector.length !== b.vector.length) continue;
      if (cosine(a.vector, b.vector) < threshold) continue;
      const rootA = find(a.id);
      const rootB = find(b.id);
      if (rootA === rootB) continue;
      const keep = precedes(byId.get(rootA)!, byId.get(rootB)!) ? rootA : rootB;
      const drop = keep === rootA ? rootB : rootA;
      parent.set(drop, keep);
    }
  }

  return new Map(unique.map((item) => [item.id, find(item.id)]));
}

/**
 * Previously indexed documents of the same workspace that are near-duplicates of
 * `item` and were posted at or before `before`. Reads Vectorize only, so it sees
 * documents indexed by earlier runs, not ones upserted in the current run. Excludes
 * `item` itself. Returns [] when Vectorize is unavailable or the call fails.
 */
export async function olderNeighbours(
  workspaceId: string,
  item: { id: string; vector: number[] },
  opts: { before: number; threshold?: number },
): Promise<string[]> {
  if (item.vector.length === 0) return [];
  const threshold = opts.threshold ?? SEMANTIC_THRESHOLDS.duplicate;
  const matches: VectorMatch[] = await queryVectors(workspaceId, item.vector, {
    kind: "doc",
    topK: NEIGHBOUR_TOP_K,
    minScore: threshold,
  });
  return matches
    .filter((match) => match.id !== item.id && (match.postedAt === undefined || match.postedAt <= opts.before))
    .map((match) => match.id);
}
