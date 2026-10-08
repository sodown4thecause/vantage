import { getVectorize } from "@/lib/cf/env";

export type VectorKind = "doc" | "profile" | "material";

export type VectorItem = {
  id: string;
  values: number[];
  kind: VectorKind;
  platform?: string;
  postedAt?: number;
};

export type VectorMatch = { id: string; score: number; postedAt?: number };

/** Vectorize accepts at most 1000 vectors per upsert from a Worker. */
const UPSERT_BATCH = 1000;
/** Vectorize allows topK up to 50 when metadata is returned. */
const MAX_TOP_K = 50;
/** Batch size for deleteByIds. */
const DELETE_BATCH = 1000;

/**
 * Only module allowed to touch the VECTORIZE binding. The workspace id is the
 * Vectorize namespace, so every read and write is scoped to one workspace. An
 * empty id throws before the binding is read, so an unscoped call cannot happen.
 *
 * Callers must keep vector ids unique per workspace: Vectorize ids are unique
 * across the whole index, so an upsert or delete with another workspace's id
 * overwrites or removes that workspace's vector. deleteByIds has no namespace
 * parameter and cannot be scoped by the API.
 */
function requireWorkspace(workspaceId: string): string {
  if (typeof workspaceId !== "string" || workspaceId.trim() === "") {
    throw new Error("vector store calls require a workspaceId");
  }
  return workspaceId;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size) out.push(items.slice(start, start + size));
  return out;
}

function toMetadata(item: VectorItem): Record<string, string | number> {
  const metadata: Record<string, string | number> = { kind: item.kind };
  if (item.platform !== undefined) metadata.platform = item.platform;
  if (item.postedAt !== undefined) metadata.postedAt = item.postedAt;
  return metadata;
}

function isQueryResponse(value: unknown): value is { matches: unknown[] } {
  return typeof value === "object" && value !== null && Array.isArray((value as { matches?: unknown }).matches);
}

function parseMatch(value: unknown): VectorMatch | null {
  if (typeof value !== "object" || value === null) return null;
  const match = value as { id?: unknown; score?: unknown; metadata?: unknown };
  if (typeof match.id !== "string" || typeof match.score !== "number" || !Number.isFinite(match.score)) return null;
  const postedAt = (match.metadata as { postedAt?: unknown } | undefined)?.postedAt;
  return typeof postedAt === "number" ? { id: match.id, score: match.score, postedAt } : { id: match.id, score: match.score };
}

function logFailure(op: string, err: unknown): void {
  // Only the error class is logged: exception text can embed endpoint details.
  console.error("[vector-store] call failed", { op, error: err instanceof Error ? err.name : "unknown" });
}

/** Upserts vectors into the workspace namespace. Returns false (never throws) on binding absence or failure. */
export async function upsertVectors(workspaceId: string, items: VectorItem[]): Promise<boolean> {
  const namespace = requireWorkspace(workspaceId);
  if (items.length === 0) return true;
  const index = await getVectorize();
  if (!index) return false;
  const vectors = items.map((item) => ({
    id: item.id,
    values: item.values,
    namespace,
    metadata: toMetadata(item),
  }));
  try {
    for (const batch of chunk(vectors, UPSERT_BATCH)) await index.upsert(batch);
    return true;
  } catch (err) {
    logFailure("upsert", err);
    return false;
  }
}

/**
 * Nearest vectors of one kind within the workspace namespace, best first.
 * Returns [] (never throws) when the binding is absent or the call fails, so
 * the caller can fall back to keyword-only scoring.
 */
export async function queryVectors(
  workspaceId: string,
  vector: number[],
  opts: { kind: VectorKind; topK: number; minScore?: number },
): Promise<VectorMatch[]> {
  const namespace = requireWorkspace(workspaceId);
  const index = await getVectorize();
  if (!index) return [];
  const requested = Number.isFinite(opts.topK) ? Math.floor(opts.topK) : 1;
  const topK = Math.min(MAX_TOP_K, Math.max(1, requested));
  try {
    const response = await index.query(vector, {
      topK,
      namespace,
      filter: { kind: opts.kind },
      returnMetadata: "all",
    });
    if (!isQueryResponse(response)) return [];
    const minScore = opts.minScore;
    return response.matches
      .map(parseMatch)
      .filter((m): m is VectorMatch => m !== null && (minScore === undefined || m.score >= minScore));
  } catch (err) {
    logFailure("query", err);
    return [];
  }
}

/** Deletes vectors by id. Returns false (never throws) on binding absence or failure. */
export async function deleteVectors(workspaceId: string, ids: string[]): Promise<boolean> {
  requireWorkspace(workspaceId);
  if (ids.length === 0) return true;
  const index = await getVectorize();
  if (!index) return false;
  try {
    for (const batch of chunk(ids, DELETE_BATCH)) await index.deleteByIds(batch);
    return true;
  } catch (err) {
    logFailure("deleteByIds", err);
    return false;
  }
}
