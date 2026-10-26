import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { gtmPostgresFixture, hasGtmTestDatabase } from "./gtm-postgres-fixture";
const context = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db/client", () => ({ getDb: () => context.db }));
import { appendGtmMessages, loadGtmChat } from "@/lib/gtm/chat/store";
import type { GtmUIMessage } from "@/lib/gtm/chat/types";

describe.skipIf(!hasGtmTestDatabase)("Postgres GTM message SQL", () => {
  let fixture: Awaited<ReturnType<typeof gtmPostgresFixture>>;
  beforeAll(async () => { fixture = await gtmPostgresFixture(); context.db = fixture.db; }, 60_000);
  afterAll(async () => { await fixture?.close(); });
  const messages: GtmUIMessage[] = [{ id: "client", role: "user", parts: [{ type: "text", text: "Find buyers" }] }];
  it("creates, appends, retries exactly and refuses stale or cross-workspace writes", async () => {
    const scope = await fixture.seed(), foreign = await fixture.seed();
    const input = { ...scope, expectedRevision: 0, requestId: "request-1", messages };
    expect(await appendGtmMessages(input)).toEqual({ revision: 1, replayed: false });
    expect(await appendGtmMessages(input)).toEqual({ revision: 1, replayed: true });
    expect(await appendGtmMessages({ ...input, expectedRevision: 1, requestId: "request-2" })).toEqual({ revision: 2, replayed: false });
    expect(await appendGtmMessages(input)).toEqual({ revision: 1, replayed: true });
    await expect(appendGtmMessages({ ...input, requestId: "stale" })).rejects.toThrow("revision conflict");
    await expect(appendGtmMessages({ ...input, messages: [{ ...messages[0]!, parts: [{ type: "text", text: "Changed" }] }] })).rejects.toThrow("revision conflict");
    await expect(appendGtmMessages({ ...input, workspaceId: foreign.workspaceId })).rejects.toThrow();
    await expect(loadGtmChat({ ...scope, workspaceId: foreign.workspaceId })).rejects.toThrow();
    const chat = await loadGtmChat(scope);
    expect(chat.revision).toBe(2); expect(chat.messages).toHaveLength(2);
    expect(new Set(chat.messages.map(m => m.id)).size).toBe(2);
  });
  it("concurrent first appends have one winner; exact simultaneous retries do not duplicate messages", async () => {
    const scope = await fixture.seed();
    const input = { ...scope, expectedRevision: 0, requestId: "same", messages };
    const results = await Promise.all([appendGtmMessages(input), appendGtmMessages(input)]);
    expect(results.map(r => r.replayed).sort()).toEqual([false, true]);
    const competing = await Promise.allSettled([appendGtmMessages({ ...input, expectedRevision: 1, requestId: "a" }), appendGtmMessages({ ...input, expectedRevision: 1, requestId: "b" })]);
    expect(competing.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect((await loadGtmChat(scope)).messages).toHaveLength(2);
  });
  it("preserves legacy messages on first append", async () => {
    const scope = await fixture.seed();
    await fixture.client`insert into seo_message (workspace_id, conversation_id, role, content, parts, status) values (${scope.workspaceId}, ${scope.conversationId}, 'assistant', 'Existing advice', '{}', 'complete')`;
    await appendGtmMessages({ ...scope, expectedRevision: 0, requestId: "first", messages });
    expect((await loadGtmChat(scope)).messages[0]!.parts).toContainEqual({ type: "text", text: "Existing advice" });
  });
  it("bounds durable history and receipts and keeps exact retry available at the limit", async () => {
    const scope = await fixture.seed();
    for (let index = 0; index < 200; index++) await appendGtmMessages({ ...scope, expectedRevision: index, requestId: `turn-${index}`, messages });
    await expect(appendGtmMessages({ ...scope, expectedRevision: 200, requestId: "overflow", messages })).rejects.toThrow("Conversation limit");
    expect(await appendGtmMessages({ ...scope, expectedRevision: 0, requestId: "turn-0", messages })).toEqual({ revision: 1, replayed: true });
    const [stored] = await fixture.client`select jsonb_array_length(messages) n, (select count(*)::int from jsonb_object_keys(receipts)) receipts from gtm_chat where conversation_id = ${scope.conversationId}`;
    expect(stored).toEqual({ n: 200, receipts: 200 });
  }, 60_000);
  it("refuses aggregate byte overflow without a partial append", async () => {
    const scope = await fixture.seed();
    const large = Array.from({ length: 17 }, (_, i) => ({ ...messages[0]!, id: String(i), parts: [{ type: "text" as const, text: "x".repeat(30_000) }] }));
    await appendGtmMessages({ ...scope, expectedRevision: 0, requestId: "large", messages: large });
    await expect(appendGtmMessages({ ...scope, expectedRevision: 1, requestId: "too-large", messages: [large[0]!] })).rejects.toThrow("Conversation limit");
    expect((await loadGtmChat(scope)).messages).toHaveLength(17);
  });
});
