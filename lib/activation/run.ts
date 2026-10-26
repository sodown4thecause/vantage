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
  if (body.runId !== undefined && (typeof body.runId !== "string" || !/^chat-[a-f0-9]{48}$/.test(body.runId))) return Response.json({ error: "invalid run" }, { status: 400 });
  const run = typeof body.runId === "string"
    ? (await db.select().from(scanRun).where(and(eq(scanRun.workspaceId, workspaceId), eq(scanRun.id, body.runId), eq(scanRun.kind, "manual"))).limit(1))[0]
    : await firstScan(workspaceId);
  if (!run) return Response.json({ error: "not found" }, { status: 404 });
  const scope = and(eq(scanRun.id, run.id), eq(scanRun.workspaceId, workspaceId), eq(scanRun.leaseToken, run.leaseToken));
  if (run.status === "cancel_requested" && body.action === "plan") return Response.json({ cancelled: true, leaseToken: run.leaseToken, sourceIds: [] });
  if (body.action === "plan") {
    if (["done", "partial", "failed", "cancelled"].includes(run.status)) return Response.json({ skipped: true });
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
      const [started] = await db.update(scanRun).set({ status: "running", sourceIds: ids, startedAt: run.startedAt ?? new Date() })
        .where(and(scope, inArray(scanRun.status, ["queued", "running"]))).returning({ id: scanRun.id });
      if (!started) { await releaseScanLease(workspaceId, lease); return Response.json({ cancelled: true, leaseToken: lease, sourceIds: [] }); }
      if (run.kind !== "manual") await captureActivation("first_scan_started", workspaceId);
      return Response.json({ leaseToken: lease, sourceIds: ids });
    } catch (error) {
      await releaseScanLease(workspaceId, lease);
      throw error;
    }
  }
  if (body.action === "finish" && body.leaseToken === undefined) {
    const status = run.status === "cancel_requested" ? "cancelled" : "failed";
    const [finished] = await db.update(scanRun).set({ status, finishedAt: new Date() }).where(and(scope, eq(scanRun.status, status === "cancelled" ? "cancel_requested" : "queued"))).returning();
    if (!finished) return Response.json({ error: "stale scan" }, { status: 409 });
    await releaseScanLease(workspaceId, run.leaseToken);
    if (run.kind !== "manual" && status === "failed") await captureActivation("first_scan_failed", workspaceId);
    return Response.json({ status });
  }
  if (body.leaseToken !== run.leaseToken) return Response.json({ error: "stale scan" }, { status: 409 });
  const finishResponse = async (finished: typeof run) => {
    if (finished.kind !== "manual" && ["done", "partial"].includes(finished.status)) {
      try {
        const result = await sendFirstScanEmail(workspaceId, finished.picked, finished.read);
        if (result?.ok === false) return Response.json({ error: "activation email unavailable" }, { status: 502 });
      } catch {
        console.error("[activation] email unavailable");
        return Response.json({ error: "activation email unavailable" }, { status: 502 });
      }
    }
    return Response.json({ status: finished.status });
  };
  if (body.action === "finish" && ["done", "partial", "failed", "cancelled"].includes(run.status)) return finishResponse(run);
  if (run.status === "cancel_requested") {
    if (body.action !== "finish") return Response.json({ cancelled: true });
    const [cancelled] = await db.update(scanRun).set({ status: "cancelled", finishedAt: new Date() })
      .where(and(scope, eq(scanRun.status, "cancel_requested"))).returning();
    await releaseScanLease(workspaceId, run.leaseToken);
    return cancelled ? finishResponse(cancelled) : Response.json({ error: "stale scan" }, { status: 409 });
  }
  const [owned] = await db.select({ id: workspace.id }).from(workspace).where(and(
    eq(workspace.id, workspaceId), eq(workspace.scanLeaseToken, run.leaseToken), gt(workspace.scanLeaseUntil, sql`now()`),
  )).limit(1);
  if (!owned) return Response.json({ error: "stale scan" }, { status: 409 });
  if (body.action === "collect") {
    if (typeof body.sourceId !== "string" || !run.sourceIds?.includes(body.sourceId)) return Response.json({ error: "not found" }, { status: 404 });
    const outcome = await withFirstScanBudget(workspaceId, run.id, () => collectSource({ workspaceId, sourceId: body.sourceId as string, signal }), run.kind !== "manual");
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
    const built = await withFirstScanBudget(workspaceId, run.id, () => buildWorkspace(workspaceId, signal), run.kind !== "manual");
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
    if (!finished) return firstScanStep(workspaceId, body, signal);
    await releaseScanLease(workspaceId, run.leaseToken);
    if (finished) {
      if (run.kind !== "manual") await captureActivation(status === "failed" ? "first_scan_failed" : "first_scan_completed", workspaceId, {
        read: finished.read, relevant: finished.relevant, picked: finished.picked, status, cost_usd: Number(finished.costUsd),
      });
      console.info("[activation] first scan finished", { workspaceId, status, costUsd: finished.costUsd });
      return finishResponse(finished);
    }
    return Response.json({ status });
  }
  return Response.json({ error: "invalid action" }, { status: 400 });
}
