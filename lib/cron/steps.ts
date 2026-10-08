import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { mapWithConcurrency } from "@/lib/async/map-with-concurrency";
import { collectorsByType } from "@/lib/collectors/registry";
import { runCollector } from "@/lib/collectors/run";
import { isCronAuthorized } from "@/lib/cron/authorize";
import { claimScanLease, releaseScanLease } from "@/lib/cron/lease";
import { eligibleSourceCondition, scanNotDueReason } from "@/lib/cron/scan";
import { getDb } from "@/lib/db/client";
import { monitoringProfile, source, workspace } from "@/lib/db/schema";
import { embedPendingDocuments } from "@/lib/embeddings/index-documents";
import { buildOpportunities } from "@/lib/opportunities/run";
import { getLatestMonitoringProfile } from "@/lib/profile/repository";

/** Shared bodies of the internal per-step scan routes (Workflow steps). Routes stay thin. */
export const MAX_DUE_WORKSPACES = 200;
export const MAX_SOURCES_PER_SCAN = 40;
export const SCAN_LEASE_MINUTES = 30;
const EMBED_DOC_LIMIT = 200;
const OPPORTUNITY_DOC_LIMIT = 50;
const STEP_DEADLINE_MS = 120_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PlanOutcome =
  | { kind: "skipped"; reason: string }
  | { kind: "busy" }
  | { kind: "planned"; leaseToken: string; sourceIds: string[] };

/**
 * Workspaces whose scheduled cadence has elapsed, that have no live lease, and that have a monitoring
 * profile (the only ones a scan can run for), oldest rotation first.
 */
export async function dueWorkspaceIds(now = new Date()): Promise<string[]> {
  const db = getDb();
  const candidates = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(and(
      or(isNull(workspace.scanLeaseUntil), lt(workspace.scanLeaseUntil, sql`now()`)),
      sql`exists (select 1 from ${monitoringProfile} where ${monitoringProfile.workspaceId} = ${workspace.id})`,
    ))
    .orderBy(workspace.updatedAt)
    .limit(MAX_DUE_WORKSPACES);
  const checked = await mapWithConcurrency(candidates, 4, async (ws) => ({
    id: ws.id,
    reason: await scanNotDueReason(ws.id, now),
  }));
  // Rotate not-due workspaces to the back, as scanWorkspace does for the tick.
  const notDue = checked.filter((ws) => ws.reason);
  await Promise.all(notDue.map((ws) => db.update(workspace).set({ updatedAt: now }).where(eq(workspace.id, ws.id))));
  return checked.filter((ws) => !ws.reason).map((ws) => ws.id);
}

/** Cadence and profile checks, then a 30-minute lease and up to 40 eligible sources (least recently polled first). */
export async function planScan(workspaceId: string, now = new Date()): Promise<PlanOutcome> {
  const reason = await scanNotDueReason(workspaceId, now);
  if (reason) return { kind: "skipped", reason };
  if (!(await getLatestMonitoringProfile(workspaceId))) {
    // Rotate the workspace to the back, as the tick path does. Without this, a profile-less workspace
    // keeps the same place in the oldest-first due window and can starve the workspaces behind it.
    await getDb().update(workspace).set({ updatedAt: new Date() }).where(eq(workspace.id, workspaceId));
    return { kind: "skipped", reason: "monitoring profile required" };
  }
  const leaseToken = await claimScanLease(workspaceId, SCAN_LEASE_MINUTES);
  if (!leaseToken) return { kind: "busy" };
  try {
    const rows = await getDb()
      .select({ id: source.id })
      .from(source)
      .where(eligibleSourceCondition(workspaceId))
      .orderBy(sql`${source.lastPolledAt} asc nulls first`, source.id)
      .limit(MAX_SOURCES_PER_SCAN);
    return { kind: "planned", leaseToken, sourceIds: rows.map((row) => row.id) };
  } catch (err) {
    await releaseScanLease(workspaceId, leaseToken);
    throw err;
  }
}

export type CollectOutcome =
  | { kind: "not_found" }
  | { kind: "failed" }
  | { kind: "ok"; body: Record<string, unknown> };

/** Runs one source's collector. The source must belong to the workspace, otherwise `not_found`. */
export async function collectSource(input: { workspaceId: string; sourceId: string; signal: AbortSignal }): Promise<CollectOutcome> {
  const [row] = await getDb()
    .select()
    .from(source)
    .where(and(eq(source.id, input.sourceId), eq(source.workspaceId, input.workspaceId)))
    .limit(1);
  if (!row) return { kind: "not_found" };
  const collector = collectorsByType[row.type];
  if (!collector) return { kind: "ok", body: { inserted: 0, skipped: 0, reason: "no collector registered" } };
  const result = await runCollector({ collector, workspaceId: input.workspaceId, sourceId: input.sourceId, signal: input.signal });
  if (result.switchedOff) return { kind: "ok", body: { inserted: 0, skipped: 0, switchedOff: result.switchedOff } };
  // Collector errors are retryable by the Workflow step; the message is not returned or logged.
  if (result.error) return { kind: "failed" };
  return { kind: "ok", body: { inserted: result.inserted, skipped: result.skipped } };
}

/** Semantic indexing is best effort: any failure is reported as zero embedded, never as a scan failure. */
export async function embedWorkspace(workspaceId: string, signal: AbortSignal): Promise<{ embedded: number }> {
  try {
    const result = await embedPendingDocuments(workspaceId, { limit: EMBED_DOC_LIMIT, signal });
    return { embedded: result.embedded };
  } catch {
    console.error("[scan-steps] embed step degraded to keyword-only; scan continues");
    return { embedded: 0 };
  }
}

export async function buildWorkspace(workspaceId: string, signal: AbortSignal) {
  if (!(await getLatestMonitoringProfile(workspaceId))) return { skipped: true, reason: "monitoring profile required" };
  return buildOpportunities({ workspaceId, limitDocs: OPPORTUNITY_DOC_LIMIT, signal });
}

/** Releases only the lease that carries this token (the UPDATE is conditional on it). */
export async function finishScan(workspaceId: string, leaseToken: string): Promise<void> {
  await releaseScanLease(workspaceId, leaseToken);
}

/**
 * Shared request handling for every internal step: fail-closed bearer auth, strict UUID
 * validation of the JSON body, and a 500 without details when the step throws.
 * The fail-closed check requires CRON_SECRET even outside production.
 */
export async function internalStep(
  req: Request,
  name: string,
  keys: readonly ("workspaceId" | "sourceId" | "leaseToken")[],
  run: (input: Record<string, string>, signal: AbortSignal, body: unknown) => Promise<Response>,
): Promise<Response> {
  if (!process.env.CRON_SECRET || !isCronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const input: Record<string, string> = {};
  let body: unknown;
  if (keys.length > 0) {
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid request" }, { status: 400 });
    }
    for (const key of keys) {
      const value = (body as Record<string, unknown> | null | undefined)?.[key];
      if (typeof value !== "string" || !UUID_RE.test(value)) {
        return NextResponse.json({ error: "invalid request" }, { status: 400 });
      }
      input[key] = value;
    }
  }
  try {
    return await run(input, AbortSignal.any([req.signal, AbortSignal.timeout(STEP_DEADLINE_MS)]), body);
  } catch {
    console.error(`[scan-steps] ${name} step failed`);
    return NextResponse.json({ error: "scan step failed" }, { status: 500 });
  }
}
