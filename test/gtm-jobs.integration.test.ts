import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { gtmPostgresFixture, hasGtmTestDatabase } from "./gtm-postgres-fixture";
const state = vi.hoisted(() => ({ db: null as unknown, create: vi.fn(async () => ({})), allowed: true }));
vi.mock("@/lib/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/lib/auth/workspace", () => ({ authorizeWorkspace: async () => ({ ok: state.allowed, userId: "gtm-test-owner", status: 403 }) }));
vi.mock("@/lib/cf/env", () => ({ readBinding: async () => ({ create: state.create }) }));
vi.mock("@/lib/profile/repository", () => ({ getLatestMonitoringProfile: async () => ({ version: 1 }) }));
import { getGtmConversationJobs, getGtmJob, requestGtmJob, requestGtmJobCancel } from "@/lib/gtm/chat/jobs";
import { reserveScanSpend, withFirstScanBudget } from "@/lib/activation/budget";

describe.skipIf(!hasGtmTestDatabase)("Postgres durable chat jobs", () => {
  let fixture: Awaited<ReturnType<typeof gtmPostgresFixture>>;
  beforeAll(async () => { fixture = await gtmPostgresFixture(); state.db = fixture.db; }, 60_000);
  afterAll(async () => { await fixture?.close(); });
  const grants = new Map<string, { conversationId: string; token: string }>();
  async function start(workspaceId: string, requestId: string) {
    const key = `${workspaceId}:${requestId}`;
    let grant = grants.get(key);
    if (!grant) {
      grant = { conversationId: crypto.randomUUID(), token: crypto.randomUUID() }; grants.set(key, grant);
      await fixture.client`insert into seo_conversation (id, workspace_id) values (${grant.conversationId}, ${workspaceId})`;
      await fixture.client`insert into gtm_chat_turn (conversation_id, workspace_id, request_id, token, payload_hash, scan_requested, expires_at) values (${grant.conversationId}, ${workspaceId}, ${requestId}, ${grant.token}, 'test-hash', true, now() + interval '90 seconds')`;
    }
    return requestGtmJob({ workspaceId, requestId, ...grant });
  }
  it("reloads a real Workflow identity, replays the request, and gives repeated scans fresh IDs", async () => {
    const { workspaceId } = await fixture.seed();
    const first = await start(workspaceId, "one");
    expect(first.state).toBe("queued");
    expect((await getGtmConversationJobs({ workspaceId, conversationId: grants.get(`${workspaceId}:one`)!.conversationId }))[0]?.id).toBe(first.id);
    expect(state.create).toHaveBeenCalledWith({ id: first.id, params: { workspaceId, kind: "manual", runId: first.id } });
    expect((await start(workspaceId, "one")).id).toBe(first.id);
    await expect(start(workspaceId, "overlapping")).rejects.toThrow("already active");
    await fixture.client`update scan_run set status = 'done' where id = ${first.id}`;
    expect((await getGtmJob({ workspaceId, jobId: first.id }))?.state).toBe("complete");
    const next = await start(workspaceId, "two");
    expect(next.id).not.toBe(first.id); expect(next.state).toBe("queued");
    expect((await start(workspaceId, "one")).state).toBe("complete");
  });
  it("keeps cancellation active and idempotent, settles an in-flight reservation, and scopes reads and writes", async () => {
    const { workspaceId } = await fixture.seed(), foreign = await fixture.seed();
    const job = await start(workspaceId, "cancel");
    await fixture.client`update scan_run set status = 'running' where id = ${job.id}`;
    const spend = await withFirstScanBudget(workspaceId, job.id, () => reserveScanSpend(workspaceId, "firecrawl", "search", 0.08));
    const cancel = { workspaceId, jobId: job.id, requestId: "same-cancel" };
    expect((await requestGtmJobCancel(cancel)).state).toBe("cancel_requested");
    expect((await requestGtmJobCancel(cancel)).state).toBe("cancel_requested");
    await expect(start(workspaceId, "overlapping")).rejects.toThrow("already active");
    await spend!.settle(0.03);
    const [row] = await fixture.client`select cost_usd, reserved_usd from scan_run where id = ${job.id}`;
    expect(Number(row!.cost_usd)).toBe(0.03); expect(Number(row!.reserved_usd)).toBe(0.08);
    await expect(withFirstScanBudget(workspaceId, job.id, () => reserveScanSpend(workspaceId, "firecrawl", "search", 0.01))).rejects.toThrow();
    expect(await getGtmJob({ workspaceId: foreign.workspaceId, jobId: job.id })).toBeNull();
    await expect(requestGtmJobCancel({ ...cancel, workspaceId: foreign.workspaceId })).rejects.toThrow();
    expect((await getGtmJob({ workspaceId, jobId: job.id }))?.state).toBe("cancel_requested");
  });
  it("does not claim dispatch success when the durable binding fails", async () => {
    const { workspaceId } = await fixture.seed();
    state.create.mockRejectedValueOnce(new Error("private transport detail"));
    const job = await start(workspaceId, "broken");
    expect(job.state).toBe("failed");
    state.allowed = false;
    await expect(getGtmJob({ workspaceId, jobId: job.id })).rejects.toThrow("Unable to access");
    state.allowed = true;
  });
});
