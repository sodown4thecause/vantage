import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { gtmPostgresFixture, hasGtmTestDatabase } from "./gtm-postgres-fixture";
const context = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db/client", () => ({ getDb: () => context.db }));
import { claimGtmTurn, finishGtmTurn, loadGtmChat } from "@/lib/gtm/chat/store";

describe.skipIf(!hasGtmTestDatabase)("Postgres generation ownership", () => {
  let fixture: Awaited<ReturnType<typeof gtmPostgresFixture>>;
  beforeAll(async () => { fixture = await gtmPostgresFixture(); context.db = fixture.db; }, 60_000);
  afterAll(async () => { await fixture?.close(); });
  it("claims before generation with one winner, exact replay, no duplicate prompt, and scoped finalization", async () => {
    const scope = await fixture.seed(), foreign = await fixture.seed();
    const input = { ...scope, expectedRevision: 0, requestId: "request-a", message: "Find buyers" };
    const results = await Promise.all([claimGtmTurn(input), claimGtmTurn(input)]);
    expect(results.map(r => r.claimed).sort()).toEqual([false, true]);
    const winner = results.find(r => r.claimed)!;
    expect((await loadGtmChat(scope)).messages).toHaveLength(1);
    await expect(claimGtmTurn({ ...input, expectedRevision: 1, requestId: "request-b" })).rejects.toThrow();
    await expect(claimGtmTurn({ ...input, message: "Changed" })).rejects.toThrow();
    const assistant = { id: "reply", role: "assistant" as const, parts: [{ type: "text" as const, text: "Partial answer", state: "done" as const }] };
    await expect(finishGtmTurn({ ...scope, requestId: input.requestId, token: "00000000-0000-4000-8000-000000000000", message: assistant, interrupted: true })).rejects.toThrow();
    await expect(finishGtmTurn({ ...scope, workspaceId: foreign.workspaceId, requestId: input.requestId, token: winner.token!, message: assistant, interrupted: true })).rejects.toThrow();
    await finishGtmTurn({ ...scope, requestId: input.requestId, token: winner.token!, message: assistant, interrupted: true });
    expect((await loadGtmChat(scope)).messages).toHaveLength(2);
    expect(await claimGtmTurn(input)).toMatchObject({ claimed: false, state: "interrupted" });
    const retried = await claimGtmTurn({ ...input, expectedRevision: 2, requestId: "retry-a", retryOf: input.requestId });
    expect(retried.claimed).toBe(true);
    expect((await loadGtmChat(scope)).messages).toHaveLength(2);
  });
  it("recovers expired ownership without retrying the original paid attempt and fences late completion", async () => {
    const scope = await fixture.seed();
    const input = { ...scope, expectedRevision: 0, requestId: "crashed", message: "Start" };
    const old = await claimGtmTurn(input);
    await fixture.client`update gtm_chat_turn set expires_at = now() - interval '1 minute' where conversation_id = ${scope.conversationId}`;
    expect(await claimGtmTurn(input)).toMatchObject({ claimed: false, state: "interrupted" });
    const next = await claimGtmTurn({ ...input, expectedRevision: 1, requestId: "next", message: "Continue" });
    expect(next.claimed).toBe(true);
    await expect(finishGtmTurn({ ...scope, requestId: "crashed", token: old.token!, message: { id: "late", role: "assistant", parts: [{ type: "text", text: "late" }] }, interrupted: false })).rejects.toThrow();
    expect((await loadGtmChat(scope)).messages.map(m => m.parts[0])).toEqual([{ type: "text", text: "Start" }, { type: "text", text: "Continue" }]);
  });
  it("reserves capacity for a terminal assistant before granting generation at the history boundary", async () => {
    const scope = await fixture.seed();
    const messages = Array.from({ length: 199 }, (_, i) => ({ id: String(i), role: "user", parts: [{ type: "text", text: "Earlier" }] }));
    await fixture.client`insert into gtm_chat (conversation_id, workspace_id, messages, revision) values (${scope.conversationId}, ${scope.workspaceId}, ${JSON.stringify(messages)}::jsonb, 198)`;
    await expect(claimGtmTurn({ ...scope, expectedRevision: 198, requestId: "full", message: "Start" })).rejects.toThrow("Conversation limit");
    const [row] = await fixture.client`select count(*)::int n from gtm_chat_turn where conversation_id = ${scope.conversationId}`;
    expect(row!.n).toBe(0);
    expect((await loadGtmChat(scope)).messages).toHaveLength(199);
  });
});
