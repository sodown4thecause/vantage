import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { eligibleSourceCondition } from "@/lib/cron/scan";
import { getDb } from "@/lib/db/client";
import { scanRun, source, workspace } from "@/lib/db/schema";
import { readLastRunReceipt } from "@/lib/collectors/coverage";
import { readSkippedScan, summariseScanHealth, type ScanHealth, type ScanIssue } from "@/lib/scan/health";

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
  let scanHealth: ScanHealth | null = null;
  if (run && ["done", "partial", "failed"].includes(run.status)) {
    const rows = run.startedAt && run.sourceIds?.length ? await db.select({ id: source.id, config: source.config })
      .from(source).where(and(eq(source.workspaceId, workspaceId), inArray(source.id, run.sourceIds))) : [];
    const start = run.startedAt?.getTime() ?? Infinity;
    const end = run.finishedAt?.getTime() ?? new Date(ws?.now ?? Date.now()).getTime();
    const receipts = rows.flatMap(row => {
      const receipt = readLastRunReceipt(row.config);
      const inRun = [receipt?.scanHealth ? { ranAt: receipt.ranAt, scanHealth: receipt.scanHealth } : undefined, readSkippedScan(row.config)]
        .flatMap(entry => entry && Date.parse(entry.ranAt) >= start && Date.parse(entry.ranAt) <= end ? [entry] : [])
        .sort((a, b) => Date.parse(a.ranAt) - Date.parse(b.ranAt));
      return inRun.slice(-1).map(entry => entry.scanHealth);
    });
    const issues: ScanIssue[] = receipts.flatMap(receipt => receipt.issues);
    const missing = receipts.length < (run.sourceIds?.length ?? 0);
    if (missing || (run.status === "failed" && !issues.length)) {
      issues.push({ stage: run.startedAt ? "review" : "dispatch", kind: "upstream_failed", retryable: true });
    }
    if (run.capped) issues.push({ stage: "review", kind: "budget_exhausted", retryable: false });
    scanHealth = summariseScanHealth({ discovered: receipts.reduce((n, receipt) => n + receipt.discovered, 0),
      verified: receipts.reduce((n, receipt) => n + receipt.verified, 0),
      completed: run.status === "done" && !missing && receipts.every(receipt => receipt.state === "complete"),
      cancelled: receipts.some(receipt => receipt.state === "cancelled"), issues });
  }
  return { run, timeZone: ws?.timeZone ?? "UTC", lastPolledAt: poll?.last ?? null, scanHealth };
}
