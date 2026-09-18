import { and, eq } from "drizzle-orm";

import type { Collector, CollectorResult, SourceType } from "@/lib/collectors/types";
import { getDb } from "@/lib/db/client";
import { document, source } from "@/lib/db/schema";

export type RunCollectorInput = {
  collector: Collector;
  workspaceId: string;
  sourceId: string;
};

export type RunCollectorOutput = {
  sourceId: string;
  collector: string;
  inserted: number;
  skipped: number;
  nextState?: CollectorResult["nextState"];
  error?: string;
};

/**
 * Load a source row, run a collector, insert documents (deduped by content_hash),
 * and persist etag/last_modified/cursor back onto the source.
 */
export async function runCollector(
  input: RunCollectorInput,
): Promise<RunCollectorOutput> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(source)
    .where(
      and(
        eq(source.id, input.sourceId),
        eq(source.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);

  if (!row) {
    return {
      sourceId: input.sourceId,
      collector: input.collector.name,
      inserted: 0,
      skipped: 0,
      error: `source ${input.sourceId} not found for workspace ${input.workspaceId}`,
    };
  }

  try {
    const result: CollectorResult = await input.collector.run({
      workspaceId: input.workspaceId,
      sourceId: input.sourceId,
      config: (row.config ?? {}) as Record<string, unknown>,
      etag: row.etag,
      lastModified: row.lastModified,
      cursor: row.cursor,
    });
    let inserted = 0;
    let skipped = 0;
    for (const doc of result.documents) {
      const rows = await db
        .insert(document)
        .values({
          ...doc,
          workspaceId: input.workspaceId,
          sourceId: input.sourceId,
        })
        .onConflictDoNothing({
          target: [document.workspaceId, document.contentHash],
        })
        .returning({ id: document.id });
      if (rows.length) inserted += 1;
      else skipped += 1;
    }

    const next = result.nextState ?? {};
    await db
      .update(source)
      .set({
        etag: next.etag === undefined ? row.etag : next.etag,
        lastModified:
          next.lastModified === undefined ? row.lastModified : next.lastModified,
        cursor: next.cursor === undefined ? row.cursor : next.cursor,
        lastPolledAt: new Date(),
        health: "healthy",
        updatedAt: new Date(),
      })
      .where(eq(source.id, row.id));

    return {
      sourceId: input.sourceId,
      collector: input.collector.name,
      inserted,
      skipped,
      nextState: result.nextState,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[collector] run failed", {
      collector: input.collector.name,
      sourceId: input.sourceId,
      workspaceId: input.workspaceId,
      error: message,
    });
    try {
      const now = new Date();
      await db
        .update(source)
        .set({ health: "failing", lastPolledAt: now, updatedAt: now })
        .where(eq(source.id, row.id));
    } catch (healthErr) {
      console.error("[collector] failed to persist source health", {
        collector: input.collector.name,
        sourceId: input.sourceId,
        error: healthErr instanceof Error ? healthErr.message : String(healthErr),
      });
    }
    return {
      sourceId: input.sourceId,
      collector: input.collector.name,
      inserted: 0,
      skipped: 0,
      error: message,
    };
  }
}

export async function runCollectorForType(opts: {
  collector: Collector;
  workspaceId: string;
  sourceType: SourceType;
  sourceId?: string;
}): Promise<RunCollectorOutput[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(source)
    .where(
      and(
        eq(source.workspaceId, opts.workspaceId),
        eq(source.type, opts.sourceType),
      ),
    );

  const targets = opts.sourceId
    ? rows.filter((r) => r.id === opts.sourceId)
    : rows;

  if (!targets.length) {
    return [
      {
        sourceId: opts.sourceId ?? "",
        collector: opts.collector.name,
        inserted: 0,
        skipped: 0,
        error: `no ${opts.sourceType} sources for workspace`,
      },
    ];
  }

  const out: RunCollectorOutput[] = [];
  for (const t of targets) {
    out.push(
      await runCollector({
        collector: opts.collector,
        workspaceId: opts.workspaceId,
        sourceId: t.id,
      }),
    );
  }
  return out;
}
