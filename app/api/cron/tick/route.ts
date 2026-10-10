import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { rollupRecent } from "@/lib/costs/rollup";
import { scanWorkspace } from "@/lib/cron/scan";
import { isCronAuthorized } from "@/lib/cron/authorize";
import { runDueDigests } from "@/lib/digest/dispatch";
import { getDb } from "@/lib/db/client";
import { workspace } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Run collectors, then refresh the profile-based opportunity queue, then
 * dispatch due daily digests.
 * Failures on one source or workspace are logged; the rest continue.
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
        const result = await scanWorkspace(ws.id, deadline, { enforceCadence: !workspaceId });
        collectorResults.push(...result.collectorResults);
        opportunityResults.push(...result.opportunityResults);
      } catch (error) {
        console.error("[tick] workspace scan failed", ws.id, error instanceof Error ? error.message : String(error));
        const busy = error instanceof Error && error.message === "Workspace scan already running.";
        opportunityResults.push(busy ? { workspaceId: ws.id, skipped: true, reason: "scan already running" } : { workspaceId: ws.id, error: "workspace scan failed" });
      }
    }

    // Best effort: cost rollups must never fail the tick (rollupRecent swallows errors).
    await rollupRecent();

    // Best effort: one workspace failing its digest must never fail the tick.
    let digest: Awaited<ReturnType<typeof runDueDigests>> | null = null;
    try {
      digest = await runDueDigests();
    } catch (error) {
      console.error(
        "[tick] digest dispatch failed",
        error instanceof Error ? error.message : String(error),
      );
    }

    return NextResponse.json({
      ok: ![...collectorResults, ...opportunityResults].some((result) => "error" in result),
      ranAt: new Date().toISOString(),
      workspaces: workspaces.length,
      collectorResults,
      opportunityResults,
      digest,
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
