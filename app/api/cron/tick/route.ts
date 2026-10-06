import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { scanWorkspace } from "@/lib/cron/scan";
import { isCronAuthorized } from "@/lib/cron/authorize";
import { getDb } from "@/lib/db/client";
import { workspace } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Run collectors, then refresh the profile-based opportunity queue.
 * Failures on one source are logged; other sources continue.
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
      // ponytail: rotate three pilot workspaces per tick; use queue fan-out for larger cohorts.
      : await db.select().from(workspace)
          .where(sql`(${workspace.scanLeaseUntil} is null or ${workspace.scanLeaseUntil} < now())`)
          .orderBy(workspace.updatedAt).limit(3);

    const collectorResults = [];
    const opportunityResults = [];
    const deadline = AbortSignal.any([req.signal, AbortSignal.timeout(120_000)]);

    for (const ws of workspaces) {
      if (deadline.aborted) {
        opportunityResults.push({ workspaceId: ws.id, skipped: true, reason: "tick deadline reached; deferred to next scan" });
        continue;
      }
      try {
        const result = await scanWorkspace(ws.id, deadline);
        collectorResults.push(...result.collectorResults);
        opportunityResults.push(...result.opportunityResults);
      } catch (error) {
        console.error("[tick] workspace scan failed", ws.id, error instanceof Error ? error.message : String(error));
        const busy = error instanceof Error && error.message === "Workspace scan already running.";
        opportunityResults.push(busy ? { workspaceId: ws.id, skipped: true, reason: "scan already running" } : { workspaceId: ws.id, error: "workspace scan failed" });
      }
    }

    return NextResponse.json({
      ok: ![...collectorResults, ...opportunityResults].some((result) => "error" in result),
      ranAt: new Date().toISOString(),
      workspaces: workspaces.length,
      collectorResults,
      opportunityResults,
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
