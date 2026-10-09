import { eq } from "drizzle-orm";

import { mapWithConcurrency } from "@/lib/async/map-with-concurrency";
import { collectorsByType } from "@/lib/collectors/registry";
import { publicCollectorError } from "@/lib/collectors/errors";
import { runCollector } from "@/lib/collectors/run";
import { runDueDigests } from "@/lib/digest/dispatch";
import { getDb } from "@/lib/db/client";
import { source, workspace } from "@/lib/db/schema";
import { runPipeline } from "@/lib/pipeline/run";

export type SweepResult = {
  ok: boolean;
  ranAt: string;
  workspaces: number;
  collectorResults: unknown[];
  pipelineResults: unknown[];
  digest: Awaited<ReturnType<typeof runDueDigests>> | null;
  error?: string;
};

/**
 * One sweep of the whole product: run every collector source, qualify what
 * was collected, then dispatch due daily digests. Optional workspaceId
 * narrows the sweep to a single workspace (manual trigger from the UI).
 *
 * A failure in one source or workspace is logged and isolated; it never
 * aborts the rest of the sweep.
 */
export async function runSweep(workspaceId?: string | null): Promise<SweepResult> {
  const collectorResults: unknown[] = [];
  const pipelineResults: unknown[] = [];
  let digest: Awaited<ReturnType<typeof runDueDigests>> | null = null;

  try {
    const db = getDb();
    const workspaces = workspaceId
      ? await db.select().from(workspace).where(eq(workspace.id, workspaceId))
      : await db.select().from(workspace);

    for (const ws of workspaces) {
      const sources = await db
        .select()
        .from(source)
        .where(eq(source.workspaceId, ws.id));

      const workspaceCollectorResults = await mapWithConcurrency(
        sources,
        4,
        async (src) => {
          const collector = collectorsByType[src.type];
          if (!collector) {
            return {
              workspaceId: ws.id,
              sourceId: src.id,
              type: src.type,
              skipped: true,
              reason: "no collector registered",
            };
          }
          try {
            const result = await runCollector({
              collector,
              workspaceId: ws.id,
              sourceId: src.id,
            });
            const { error, ...publicResult } = result;
            return {
              workspaceId: ws.id,
              ...publicResult,
              type: src.type,
              ...(error ? { error: publicCollectorError(error) } : {}),
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error("[sweep] collector failed", src.id, message);
            return {
              workspaceId: ws.id,
              sourceId: src.id,
              type: src.type,
              error: publicCollectorError(message),
              inserted: 0,
              skipped: 0,
              collector: collector.name,
            };
          }
        },
      );
      collectorResults.push(...workspaceCollectorResults);

      try {
        const pipe = await runPipeline({ workspaceId: ws.id });
        pipelineResults.push({ workspaceId: ws.id, ...pipe });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[sweep] pipeline failed", ws.id, message);
        pipelineResults.push({ workspaceId: ws.id, error: "pipeline failed" });
      }
    }

    try {
      digest = await runDueDigests();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[sweep] digest dispatch failed", message);
    }

    return {
      ok: true,
      ranAt: new Date().toISOString(),
      workspaces: workspaces.length,
      collectorResults,
      pipelineResults,
      digest,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sweep] failed", message);
    return {
      ok: false,
      ranAt: new Date().toISOString(),
      workspaces: 0,
      collectorResults,
      pipelineResults,
      digest,
      error: "cron tick failed",
    };
  }
}
