import type { VectorizeBinding } from "@/lib/cf/env";

export type FakeVectorizeCall =
  | { op: "upsert"; vectors: Array<{ id: string; namespace?: string; metadata?: Record<string, unknown> }> }
  | { op: "query"; vector: number[]; options: { topK: number; namespace?: string; filter?: Record<string, unknown> } }
  | { op: "deleteByIds"; ids: string[] };

export type FakeVectorizeOptions = {
  /** Error thrown by every call. */
  throws?: Error;
};

type StoredVector = { namespace?: string; values: number[]; metadata?: Record<string, unknown> };

const MAX_UPSERT_BATCH = 1000;
const MAX_TOP_K_WITH_METADATA = 50;

function cosine(a: number[], b: number[]): number {
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

/**
 * Stand-in for env.VECTORIZE. In-memory cosine search, no network. Mirrors the
 * real index where vector ids are unique across the whole index (an upsert
 * under an existing id overwrites it regardless of namespace), and enforces the
 * documented limits: 1000 vectors per upsert and topK <= 50 when metadata is
 * returned.
 */
export function createFakeVectorize(opts: FakeVectorizeOptions = {}) {
  const calls: FakeVectorizeCall[] = [];
  const store = new Map<string, StoredVector>();

  const binding: VectorizeBinding = {
    async upsert(vectors) {
      const items = vectors as Array<{ id: string; values: number[]; namespace?: string; metadata?: Record<string, unknown> }>;
      calls.push({ op: "upsert", vectors: items.map(({ id, namespace, metadata }) => ({ id, namespace, metadata })) });
      if (opts.throws) throw opts.throws;
      if (items.length > MAX_UPSERT_BATCH) throw new Error("upsert batch exceeds 1000 vectors");
      for (const item of items) {
        store.set(item.id, { namespace: item.namespace, values: item.values, metadata: item.metadata });
      }
      return { mutationId: "fake-mutation", count: items.length };
    },
    async query(vector, options) {
      const o = (options ?? {}) as { topK?: number; namespace?: string; filter?: Record<string, unknown>; returnMetadata?: string };
      const topK = o.topK ?? 10;
      calls.push({ op: "query", vector, options: { topK, namespace: o.namespace, filter: o.filter } });
      if (opts.throws) throw opts.throws;
      if (o.returnMetadata === "all" && topK > MAX_TOP_K_WITH_METADATA) {
        throw new Error("topK must be <= 50 when returning metadata");
      }
      const matches = [...store.entries()]
        .filter(([, v]) => o.namespace === undefined || v.namespace === o.namespace)
        .filter(([, v]) =>
          Object.entries(o.filter ?? {}).every(([key, value]) => v.metadata?.[key] === value),
        )
        .map(([id, v]) => ({
          id,
          score: cosine(vector, v.values),
          ...(o.returnMetadata === "all" ? { metadata: v.metadata } : {}),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
      return { count: matches.length, matches };
    },
    async deleteByIds(ids) {
      calls.push({ op: "deleteByIds", ids: [...ids] });
      if (opts.throws) throw opts.throws;
      let count = 0;
      for (const id of ids) if (store.delete(id)) count++;
      return { mutationId: "fake-mutation", count };
    },
  };
  return { binding, calls, store };
}
