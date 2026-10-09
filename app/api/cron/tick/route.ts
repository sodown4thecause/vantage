import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { mapWithConcurrency } from "@/lib/async/map-with-concurrency";
import { collectorsByType } from "@/lib/collectors/registry";
import { publicCollectorError } from "@/lib/collectors/errors";
import { runCollector } from "@/lib/collectors/run";
import { isCronAuthorized } from "@/lib/cron/authorize";
import { runDueDigests } from "@/lib/digest/dispatch";
import { getDb } from "@/lib/db/client";
import { source, workspace } from "@/lib/db/schema";
import { runPipeline } from "@/lib/pipeline/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 3-hour tick: run every free-lane collector source, then pipeline, then
 * dispatch due daily digests. Failures on one source are logged; other
 * sources continue.
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const workspaceId = url.searchParams.get("workspaceId");

  try {
    const db = getDb();
    const workspaces = workspaceId
      ? await db
          .select()
          .from(workspace)
          .where(eq(workspace.id, workspaceId))
      : await db.select().from(workspace);

    const collectorResults = [];
    const pipelineResults = [];
    let digestSummary: Awaited<ReturnType<typeof runDueDigests>> | null = null;

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
            console.error("[tick] collector failed", src.id, message);
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
        console.error("[tick] pipeline failed", ws.id, message);
        pipelineResults.push({ workspaceId: ws.id, error: "pipeline failed" });
      }
    }

    try {
      digestSummary = await runDueDigests();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[tick] digest dispatch failed", message);
    }

    return NextResponse.json({
      ok: true,
      ranAt: new Date().toISOString(),
      workspaces: workspaces.length,
      collectorResults,
      pipelineResults,
      digest: digestSummary,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[tick] request failed", message);
    return NextResponse.json({ error: "cron tick failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return GET(req);
}
