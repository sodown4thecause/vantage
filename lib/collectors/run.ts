import { and, eq, sql } from "drizzle-orm";

import {
  classifyCollectorCoverage,
  documentsAreFixtureOnly,
  type SourceRunReceipt,
} from "@/lib/collectors/coverage";
import type {
  Collector,
  CollectorResult,
  SourceType,
} from "@/lib/collectors/types";
import { getDb } from "@/lib/db/client";
import { document, source } from "@/lib/db/schema";

export type RunCollectorInput = {
  collector: Collector;
  workspaceId: string;
  sourceId: string;
  signal?: AbortSignal;
};

export type RunCollectorOutput = {
  sourceId: string;
  collector: string;
  inserted: number;
  skipped: number;
  nextState?: CollectorResult["nextState"];
  receipt?: SourceRunReceipt;
  error?: string;
};

/**
 * Load a source row, run a collector, insert documents (deduped by content_hash),
 * and persist etag/cursor + a coverage receipt back onto the source.
 * Failures are isolated per source — callers may continue other sources.
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

  if (row.health === "paused") {
    return { sourceId: row.id, collector: input.collector.name, inserted: 0, skipped: 0 };
  }

  let inserted = 0;
  let skipped = 0;
  try {
    input.signal?.throwIfAborted();
    // ponytail: free pilot only; add paid lanes after enforceable spend limits.
    if (process.env.NODE_ENV === "production" &&
        (row.lane !== "free" || !["hn", "rss", "substack"].includes(row.type))) {
      throw new Error("Budget limited: paid providers are disabled for the production pilot.");
    }
    const result: CollectorResult = await input.collector.run({
      workspaceId: input.workspaceId,
      sourceId: input.sourceId,
      config: (row.config ?? {}) as Record<string, unknown>,
      signal: input.signal,
      etag: row.etag,
      lastModified: row.lastModified,
      cursor: row.cursor,
    });
    if (process.env.NODE_ENV === "production" &&
        result.documents.some((doc) => documentsAreFixtureOnly([doc]))) {
      throw new Error("Access pending: synthetic provider output rejected; configure live access.");
    }
    if (result.documents.length) {
      input.signal?.throwIfAborted();
      const rows = await db.insert(document).values(result.documents.map((doc) => ({
        ...doc, workspaceId: input.workspaceId, sourceId: input.sourceId,
      }))).onConflictDoNothing({ target: [document.workspaceId, document.contentHash] }).returning({ id: document.id });
      inserted = rows.length;
      skipped = result.documents.length - inserted;
    }

    const classified = classifyCollectorCoverage({
      documents: result.documents,
      inserted,
      skipped,
    });
    const receipt: SourceRunReceipt = {
      ...classified,
      ranAt: new Date().toISOString(),
    };

    const next = result.nextState ?? {};
    await db
      .update(source)
      .set({
        etag: next.etag === undefined ? row.etag : next.etag,
        lastModified:
          next.lastModified === undefined ? row.lastModified : next.lastModified,
        cursor: next.cursor === undefined ? row.cursor : next.cursor,
        lastPolledAt: new Date(),
        health: receipt.health,
        config: sql`${source.config} || ${JSON.stringify({ lastRun: receipt })}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(source.id, row.id));

    return {
      sourceId: input.sourceId,
      collector: input.collector.name,
      inserted,
      skipped,
      nextState: result.nextState,
      receipt,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[collector] run failed", {
      collector: input.collector.name,
      sourceId: input.sourceId,
      workspaceId: input.workspaceId,
      error: message,
    });
    const classified = classifyCollectorCoverage({
      documents: [],
      inserted,
      skipped,
      error: message,
    });
    const receipt: SourceRunReceipt = {
      ...classified,
      ranAt: new Date().toISOString(),
    };
    try {
      const now = new Date();
      await db
        .update(source)
        .set({
          health: receipt.health,
          lastPolledAt: now,
          updatedAt: now,
          config: sql`${source.config} || ${JSON.stringify({ lastRun: receipt })}::jsonb`,
        })
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
      inserted,
      skipped,
      receipt,
      error: message,
    };
  }
}

export async function runCollectorForType(opts: {
  collector: Collector;
  workspaceId: string;
  sourceType: SourceType;
  sourceId?: string;
  signal?: AbortSignal;
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
        signal: opts.signal,
      }),
    );
  }
  return out;
}
