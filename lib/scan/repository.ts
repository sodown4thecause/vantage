import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { eligibleSourceCondition } from "@/lib/cron/scan";
import { getDb } from "@/lib/db/client";
import { scanRun, source, workspace } from "@/lib/db/schema";

export const firstScanId = (workspaceId: string) => `first-${workspaceId}`;

export async function firstScanWorkspaceExists(workspaceId: string): Promise<boolean> {
  const [ws] = await getDb().select({ id: workspace.id }).from(workspace).where(eq(workspace.id, workspaceId)).limit(1);
  return Boolean(ws);
}

function staleFirstScanCondition(workspaceId: string) {
  return and(
    eq(scanRun.workspaceId, workspaceId), eq(scanRun.id, firstScanId(workspaceId)), inArray(scanRun.status, ["queued", "running"]),
    sql`coalesce(${scanRun.startedAt}, ${scanRun.createdAt}) < now() - interval '35 minutes'`,
    sql`exists (select 1 from ${workspace} where ${workspace.id} = ${workspaceId} and (${workspace.scanLeaseUntil} is null or ${workspace.scanLeaseUntil} < now()))`,
  );
}

export async function recoverStaleFirstScan(workspaceId: string) {
  await getDb().update(scanRun).set({ status: "failed", finishedAt: new Date() })
    .where(staleFirstScanCondition(workspaceId));
}

export async function getFirstScanStatus(workspaceId: string, storedRun: typeof scanRun.$inferSelect | null) {
  const db = getDb();
  const [ws] = await db.select({
    timeZone: workspace.digestTimeZone,
    stale: sql<boolean>`exists (select 1 from ${scanRun} where ${staleFirstScanCondition(workspaceId)})`,
    now: sql<Date>`now()`.mapWith(scanRun.createdAt),
  }).from(workspace).where(eq(workspace.id, workspaceId)).limit(1);
  const run = storedRun && ws?.stale ? { ...storedRun, status: "failed", finishedAt: ws.now } : storedRun;
  const [poll] = await db.select({ last: sql<Date | string | null>`max(${source.lastPolledAt})` })
    .from(source).where(and(eligibleSourceCondition(workspaceId),
      or(isNull(source.lastPolledAt), lt(source.lastPolledAt, sql`now() + interval '5 minutes'`))));
  return { run, timeZone: ws?.timeZone ?? "UTC", lastPolledAt: poll?.last ?? null };
}
