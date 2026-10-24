import { and, eq, gt, inArray, sql } from "drizzle-orm";

import { withFirstScanBudget } from "@/lib/activation/budget";
import { firstScan } from "@/lib/activation/dispatch";
import { captureActivation } from "@/lib/analytics/activation";
import { claimScanLease, releaseScanLease } from "@/lib/cron/lease";
import { eligibleSourceCondition, scanOrder } from "@/lib/cron/scan";
import { buildWorkspace, collectSource } from "@/lib/cron/steps";
import { getDb } from "@/lib/db/client";
import { scanRun, source, workspace } from "@/lib/db/schema";
import { sendFirstScanEmail } from "@/lib/email/activation";
import { getLatestMonitoringProfile } from "@/lib/profile/repository";

export async function firstScanStep(workspaceId: string, body: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
  const db = getDb();
  const run = await firstScan(workspaceId);
  if (!run) return Response.json({ error: "not found" }, { status: 404 });
  const scope = and(eq(scanRun.id, run.id), eq(scanRun.workspaceId, workspaceId), eq(scanRun.leaseToken, run.leaseToken));
  if (body.action === "plan") {
    if (["done", "partial"].includes(run.status)) return Response.json({ skipped: true });
    if (!(await getLatestMonitoringProfile(workspaceId))) return Response.json({ error: "profile required" }, { status: 400 });
    const lease = await claimScanLease(workspaceId, 30, run.leaseToken);
    if (!lease) return Response.json({ error: "scan already running" }, { status: 409 });
    try {
      let ids = run.sourceIds;
      if (!ids) {
        const rows = await db.select({ id: source.id }).from(source).where(and(
          eligibleSourceCondition(workspaceId, { includeKeyed: true }),
          inArray(source.type, ["hn", "rss", "substack", "github", "stackoverflow", "reddit"]),
        )).orderBy(...await scanOrder()).limit(9);
        ids = rows.slice(0, 8).map((row) => row.id);
        if (rows.length > 8) await db.update(scanRun).set({ capped: true }).where(scope);
      }
      await db.update(scanRun).set({ status: "running", sourceIds: ids, startedAt: run.startedAt ?? new Date() }).where(scope);
      await captureActivation("first_scan_started", workspaceId);
      return Response.json({ leaseToken: lease, sourceIds: ids });
    } catch (error) {
      await releaseScanLease(workspaceId, lease);
      throw error;
    }
  }
  if (body.action === "finish" && body.leaseToken === undefined) {
    await db.update(scanRun).set({ status: "failed", finishedAt: new Date() }).where(and(scope, eq(scanRun.status, "queued")));
    await captureActivation("first_scan_failed", workspaceId);
    return Response.json({ status: "failed" });
  }
  if (body.leaseToken !== run.leaseToken) return Response.json({ error: "stale scan" }, { status: 409 });
  if (body.action === "finish" && ["done", "partial", "failed"].includes(run.status)) return Response.json({ status: run.status });
  const [owned] = await db.select({ id: workspace.id }).from(workspace).where(and(
    eq(workspace.id, workspaceId), eq(workspace.scanLeaseToken, run.leaseToken), gt(workspace.scanLeaseUntil, sql`now()`),
  )).limit(1);
  if (!owned) return Response.json({ error: "stale scan" }, { status: 409 });
  if (body.action === "collect") {
    if (typeof body.sourceId !== "string" || !run.sourceIds?.includes(body.sourceId)) return Response.json({ error: "not found" }, { status: 404 });
    const outcome = await withFirstScanBudget(workspaceId, run.id, () => collectSource({ workspaceId, sourceId: body.sourceId as string, signal }));
    if (outcome.kind === "not_found") return Response.json({ error: "not found" }, { status: 404 });
    if (outcome.kind === "failed") return Response.json({ error: "collector failed" }, { status: 502 });
    const read = Number(outcome.body.inserted ?? 0) + Number(outcome.body.skipped ?? 0);
    return Response.json({ read, partial: outcome.body.partial === true });
  }
  if (body.action === "read") {
    const read = typeof body.read === "number" && Number.isInteger(body.read) && body.read >= 0 ? body.read : 0;
    await db.update(scanRun).set({ read }).where(scope);
    return Response.json({ read });
  }
  if (body.action === "build") {
    const built = await withFirstScanBudget(workspaceId, run.id, () => buildWorkspace(workspaceId, signal));
    if ("skipped" in built) throw new Error("profile unavailable");
    const relevant = built.relevant ?? built.top.length;
    await db.update(scanRun).set({
      read: Math.max(run.read, built.scanned), relevant, picked: built.top.length,
      capped: sql`${scanRun.capped} or ${built.coverage === "budget_limited"}`,
    }).where(scope);
    return Response.json({ picked: built.top.length, partial: built.coverage === "budget_limited" });
  }
  if (body.action === "finish") {
    const status = body.failed === true ? "failed" : run.capped || body.partial === true ? "partial" : "done";
    const [finished] = await db.update(scanRun).set({ status, finishedAt: new Date() })
      .where(and(scope, inArray(scanRun.status, ["queued", "running"])) ).returning();
    await releaseScanLease(workspaceId, run.leaseToken);
    if (finished) {
      await captureActivation(status === "failed" ? "first_scan_failed" : "first_scan_completed", workspaceId, {
        read: finished.read, relevant: finished.relevant, picked: finished.picked, status, cost_usd: Number(finished.costUsd),
      });
      console.info("[activation] first scan finished", { workspaceId, status, costUsd: finished.costUsd });
      if (status !== "failed") await sendFirstScanEmail(workspaceId, finished.picked, finished.sourceIds?.length ?? 0).catch(() => console.error("[activation] email unavailable"));
    }
    return Response.json({ status });
  }
  return Response.json({ error: "invalid action" }, { status: 400 });
}
