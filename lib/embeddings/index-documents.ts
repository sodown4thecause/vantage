import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { document } from "@/lib/db/schema";
import { EMBEDDING_MODEL, embedTexts } from "@/lib/embeddings/embed";
import { upsertVectors, type VectorItem } from "@/lib/embeddings/store";
import { normalizeDocument } from "@/lib/pipeline/normalize";

/**
 * Embeds up to `limit` of the workspace's documents that have no embedding yet,
 * newest collected first. Documents with empty normalised text are marked
 * embedded without a vector so they are not selected forever. When embedding or
 * the vector write is unavailable nothing is marked, so the rows are retried
 * on a later run.
 */
export async function embedPendingDocuments(
  workspaceId: string,
  opts: { limit: number; signal?: AbortSignal },
): Promise<{ embedded: number; skipped?: "unavailable"; vectors: Map<string, number[]> }> {
  const db = getDb();
  const rows = await db
    .select()
    .from(document)
    .where(and(eq(document.workspaceId, workspaceId), isNull(document.embeddedAt)))
    .orderBy(desc(document.collectedAt))
    .limit(opts.limit);
  if (rows.length === 0) return { embedded: 0, vectors: new Map() };

  const embeddable: Array<{ id: string; text: string; platform: string; postedAt?: number }> = [];
  const blankIds: string[] = [];
  for (const row of rows) {
    const normalized = normalizeDocument(row);
    if (normalized) {
      embeddable.push({
        id: row.id,
        text: normalized.text,
        platform: normalized.platform,
        postedAt: normalized.postedAt?.getTime(),
      });
    } else {
      blankIds.push(row.id);
    }
  }

  const computed = new Map<string, number[]>();
  if (embeddable.length > 0) {
    const vectors = await embedTexts(
      embeddable.map((item) => item.text),
      { workspaceId, sourceKey: "document-index", signal: opts.signal },
    );
    if (vectors === null) return { embedded: 0, skipped: "unavailable", vectors: new Map() };

    const items: VectorItem[] = embeddable.map((item, i) => ({
      id: `doc:${item.id}`,
      values: vectors[i],
      kind: "doc",
      platform: item.platform,
      postedAt: item.postedAt,
    }));
    const upserted = await upsertVectors(workspaceId, items);
    if (!upserted) return { embedded: 0, skipped: "unavailable", vectors: new Map() };

    embeddable.forEach((item, i) => computed.set(item.id, vectors[i]));
    await db
      .update(document)
      .set({ embeddingModel: EMBEDDING_MODEL, embeddedAt: new Date() })
      .where(and(eq(document.workspaceId, workspaceId), inArray(document.id, embeddable.map((item) => item.id))));
  }

  if (blankIds.length > 0) {
    await db
      .update(document)
      .set({ embeddedAt: new Date() })
      .where(and(eq(document.workspaceId, workspaceId), inArray(document.id, blankIds)));
  }

  // Vectors for the documents just written, so callers can score them without embedding again.
  return { embedded: embeddable.length, vectors: computed };
}
