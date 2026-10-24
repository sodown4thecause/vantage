import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import { firstScan, startFirstScan } from "@/lib/activation/dispatch";
import { authorizeWorkspace } from "@/lib/auth/workspace";
import { getDb } from "@/lib/db/client";
import { scanRun, source, workspace } from "@/lib/db/schema";
import { getLimits, getWorkspacePlan } from "@/lib/plans/limits";
import { eligibleSourceCondition } from "@/lib/cron/scan";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const parsed = z.uuid().safeParse(new URL(req.url).searchParams.get("workspaceId"));
  if (!parsed.success || !(await authorizeWorkspace(parsed.data)).ok) return Response.json({ error: "not found" }, { status: 404 });
  const workspaceId = parsed.data;
  try {
    const db = getDb();
    await db.update(scanRun).set({ status: "failed", finishedAt: new Date() }).where(and(
      eq(scanRun.workspaceId, workspaceId), eq(scanRun.id, `first-${workspaceId}`), inArray(scanRun.status, ["queued", "running"]),
      sql`coalesce(${scanRun.startedAt}, ${scanRun.createdAt}) < now() - interval '35 minutes'`,
      sql`exists (select 1 from ${workspace} where ${workspace.id} = ${workspaceId} and (${workspace.scanLeaseUntil} is null or ${workspace.scanLeaseUntil} < now()))`,
    ));
    const run = await firstScan(workspaceId);
    const [ws] = await db.select({ timeZone: workspace.digestTimeZone }).from(workspace).where(eq(workspace.id, workspaceId)).limit(1);
    const [poll] = await db.select({ last: sql<Date | string | null>`max(${source.lastPolledAt})`, count: sql<number>`count(*)` })
      .from(source).where(and(eligibleSourceCondition(workspaceId),
        or(isNull(source.lastPolledAt), lt(source.lastPolledAt, sql`now() + interval '5 minutes'`))));
    const limits = await getLimits(await getWorkspacePlan(workspaceId));
    const last = poll?.last ? new Date(poll.last).getTime() : Date.now();
    const nextScanAt = new Date(Math.max(Date.now(), last + limits.scan_interval_hours * 3600_000)).toISOString();
    return Response.json({
      run: run ? { status: run.status, read: run.read, relevant: run.relevant, picked: run.picked,
        costUsd: run.costUsd, capped: run.capped, startedAt: run.startedAt, finishedAt: run.finishedAt } : null,
      nextScanAt, timeZone: ws?.timeZone ?? "UTC",
      reason: Number(run?.sourceIds?.length ?? poll?.count ?? 0) < 2 ? "Few sources are configured. Check your sources or add one." : "Your topics may be too narrow. Try broader wording in your profile.",
    }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "Scan status is unavailable. Please try again." }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const parsed = z.object({ workspaceId: z.uuid() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success || !(await authorizeWorkspace(parsed.data.workspaceId)).ok) return Response.json({ error: "not found" }, { status: 404 });
  const result = await startFirstScan(parsed.data.workspaceId, true);
  return Response.json(result, { status: result.status === "failed" ? 503 : 202 });
}
