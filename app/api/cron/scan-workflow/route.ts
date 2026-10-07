import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { isCronAuthorized } from "@/lib/cron/authorize";
import { getDb } from "@/lib/db/client";
import { workspace } from "@/lib/db/schema";
import { enqueueRadarScan, isRadarScanEnv, type RadarScanEnv } from "@/lib/workflows/radar-scan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Authenticated trigger that enqueues one durable `RadarScanWorkflow` per
 * eligible workspace, instead of scanning inline. The inline tick lives at
 * `/api/cron/tick`; this route is the Workflow-mode sibling so neither path
 * has to gate the other on a runtime branch.
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const workspaceId = url.searchParams.get("workspaceId");
  const enforceCadence = !workspaceId;

  try {
    const db = getDb();
    const workspaces = workspaceId
      ? await db.select().from(workspace).where(sql`${workspace.id} = ${workspaceId}`)
      : await db
          .select()
          .from(workspace)
          .where(sql`(${workspace.scanLeaseUntil} is null or ${workspace.scanLeaseUntil} < now())`)
          .orderBy(workspace.updatedAt)
          .limit(3);

    const env = await getRadarScanEnv();
    if (!env) {
      return NextResponse.json({ error: "RADAR_SCAN workflow binding is not available" }, { status: 503 });
    }

    const enqueued: Array<{ workspaceId: string; instanceId: string }> = [];
    const skipped: Array<{ workspaceId: string; reason: string }> = [];

    for (const ws of workspaces) {
      try {
        const instanceId = await enqueueRadarScan(env, { workspaceId: ws.id, enforceCadence });
        enqueued.push({ workspaceId: ws.id, instanceId });
      } catch (error) {
        console.error(
          "[scan-workflow] enqueue failed",
          ws.id,
          error instanceof Error ? error.message : String(error),
        );
        skipped.push({ workspaceId: ws.id, reason: "enqueue failed" });
      }
    }

    return NextResponse.json({
      ok: skipped.length === 0,
      ranAt: new Date().toISOString(),
      workspaces: workspaces.length,
      enqueued,
      skipped,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[scan-workflow] request failed", message);
    return NextResponse.json({ error: "scan workflow trigger failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return GET(req);
}

/**
 * The `RADAR_SCAN` binding is supplied by the Workers runtime; `getCloudflareContext`
 * reaches it from inside an OpenNext request. Outside a Workers request (tests,
 * local dev without bindings) it is absent, so the caller answers 503 rather
 * than throwing.
 */
async function getRadarScanEnv(): Promise<RadarScanEnv | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const env: unknown = getCloudflareContext().env;
    return isRadarScanEnv(env) ? env : null;
  } catch {
    return null;
  }
}
