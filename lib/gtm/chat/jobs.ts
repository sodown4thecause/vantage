import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { proposalActor } from "@/lib/gtm/proposals/repository";
import { readBinding } from "@/lib/cf/env";
import { getDb } from "@/lib/db/client";
import { rowsOf } from "@/lib/db/rows";
import { scanRun } from "@/lib/db/schema";
import { getFirstScanStatus } from "@/lib/scan/repository";
import type { ScanHealth } from "@/lib/scan/health";
import { getLatestMonitoringProfile } from "@/lib/profile/repository";

export type GtmJob = { id: string; workspaceId: string; state: "queued" | "running" | "complete" | "partial" | "failed" | "cancel_requested" | "cancelled"; health: ScanHealth | null };
export const jobScopeSchema = z.strictObject({ workspaceId: z.uuid(), jobId: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/) });
const requestId = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);

async function dispatch(run: typeof scanRun.$inferSelect) {
  if (run.kind !== "manual" || !(run.status === "queued" || (run.status === "cancel_requested" && !run.startedAt))) return;
  const binding = await readBinding("SCAN") as { create(input: { id: string; params: { workspaceId: string; kind: "manual"; runId: string } }): Promise<unknown> } | undefined;
  try {
    if (!binding?.create) throw new Error("Durable scan unavailable");
    await binding.create({ id: run.id, params: { workspaceId: run.workspaceId, kind: "manual", runId: run.id } });
  } catch (error) {
    if (!/already (exist|used)/i.test(error instanceof Error ? error.message : "")) {
      await getDb().update(scanRun).set({ status: "failed", finishedAt: new Date() }).where(and(eq(scanRun.workspaceId, run.workspaceId), eq(scanRun.id, run.id), inArray(scanRun.status, ["queued", "cancel_requested"])));
    }
  }
}

export async function getGtmJob(input: { workspaceId: string; jobId: string }): Promise<GtmJob | null> {
  const { workspaceId, jobId } = jobScopeSchema.parse(input);
  await proposalActor(workspaceId);
  let [run] = await getDb().select().from(scanRun).where(and(eq(scanRun.workspaceId, workspaceId), eq(scanRun.id, jobId))).limit(1);
  if (!run) return null;
  // Reconcile a previously authorized queued job after a crash between row creation and dispatch.
  await dispatch(run);
  [run] = await getDb().select().from(scanRun).where(and(eq(scanRun.workspaceId, workspaceId), eq(scanRun.id, jobId))).limit(1);
  if (!run) return null;
  const { scanHealth } = await getFirstScanStatus(workspaceId, run);
  return { id: run.id, workspaceId, state: run.status === "done" ? "complete" : run.status, health: scanHealth };
}

export async function requestGtmJobCancel(input: { workspaceId: string; jobId: string; requestId: string }): Promise<GtmJob> {
  const { workspaceId, jobId } = jobScopeSchema.parse({ workspaceId: input.workspaceId, jobId: input.jobId });
  requestId.parse(input.requestId);
  await proposalActor(workspaceId);
  // Repeating a cancellation request is intrinsically idempotent; only the Workflow acknowledges cancellation.
  await getDb().update(scanRun).set({ status: "cancel_requested" })
    .where(and(eq(scanRun.workspaceId, workspaceId), eq(scanRun.id, jobId), inArray(scanRun.status, ["queued", "running"])));
  const job = await getGtmJob({ workspaceId, jobId });
  if (!job) throw new Error("Job unavailable");
  return job;
}

/** Same request reuses its Workflow; a later explicit request gets a new durable run, including after completion. */
export async function requestGtmJob(input: { workspaceId: string; requestId: string; conversationId: string; token: string }): Promise<GtmJob> {
  const workspaceId = z.uuid().parse(input.workspaceId), key = requestId.parse(input.requestId);
  const conversationId = z.uuid().parse(input.conversationId), token = z.uuid().parse(input.token);
  await proposalActor(workspaceId);
  if (!(await getLatestMonitoringProfile(workspaceId))) throw new Error("Confirm a product profile before scanning");
  const id = `chat-${createHash("sha256").update(`${workspaceId}:${key}`).digest("hex").slice(0, 48)}`;
  const db = getDb();
  const linked = rowsOf(await db.execute(sql`with permitted as materialized (
    select * from gtm_chat_turn where workspace_id = ${workspaceId}::uuid and conversation_id = ${conversationId}::uuid and request_id = ${key} and token = ${token}::uuid and scan_requested and state = 'running' and expires_at > now()
  ), inserted as (
    insert into scan_run (id, workspace_id, kind, lease_token) select ${id}, workspace_id, 'manual', ${crypto.randomUUID()}::uuid from permitted on conflict do nothing returning id
  ) update gtm_chat_turn set job_id = ${id} where conversation_id = ${conversationId}::uuid and workspace_id = ${workspaceId}::uuid and request_id = ${key} and token = ${token}::uuid
    and exists (select 1 from permitted) and (exists (select 1 from inserted) or exists (select 1 from scan_run where id = ${id} and workspace_id = ${workspaceId}::uuid)) returning job_id`));
  if (!linked.length) throw new Error("A scan is already active or this turn has no scan permission");
  const [run] = await db.select().from(scanRun).where(and(eq(scanRun.workspaceId, workspaceId), eq(scanRun.id, id))).limit(1);
  if (!run) throw new Error("A scan is already active");
  // A one-off scan does not acknowledge unrelated recurring effects in the proposal outbox.
  return (await getGtmJob({ workspaceId, jobId: id }))!;
}

export async function getGtmConversationJobs(input: { workspaceId: string; conversationId: string }): Promise<GtmJob[]> {
  const workspaceId = z.uuid().parse(input.workspaceId), conversationId = z.uuid().parse(input.conversationId);
  await proposalActor(workspaceId);
  const rows = rowsOf(await getDb().execute(sql`select job_id as id from gtm_chat_turn where workspace_id = ${workspaceId}::uuid and conversation_id = ${conversationId}::uuid and job_id is not null order by expires_at desc limit 20`)) as { id: string }[];
  const jobs = await Promise.all(rows.map(row => getGtmJob({ workspaceId, jobId: row.id })));
  return jobs.filter(job => job !== null);
}
