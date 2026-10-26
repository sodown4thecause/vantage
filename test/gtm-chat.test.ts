import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";

const state = vi.hoisted(() => ({ authorize: vi.fn(), get: vi.fn(), consume: vi.fn(), release: vi.fn(), claim: vi.fn(), finish: vi.fn(), load: vi.fn(), ensure: vi.fn(), execute: vi.fn(), record: vi.fn(), model: null as unknown, waits: [] as Promise<unknown>[], unavailableLifetime: false }));
vi.mock("@/lib/auth/workspace", () => ({ authorizeWorkspace: state.authorize }));
vi.mock("@/lib/seo-agent/conversations", async original => ({ ...await original<typeof import("@/lib/seo-agent/conversations")>(), getConversation: state.get }));
vi.mock("@/lib/plans/limits", () => ({ consume: state.consume, release: state.release }));
vi.mock("@/lib/gtm/chat/store", async original => ({ ...await original<typeof import("@/lib/gtm/chat/store")>(), claimGtmTurn: state.claim, finishGtmTurn: state.finish, loadGtmChat: state.load, ensureGtmConversation: state.ensure }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({ execute: state.execute }) }));
vi.mock("@/lib/costs/ledger", async original => ({ ...await original<typeof import("@/lib/costs/ledger")>(), recordCost: state.record }));
vi.mock("@/lib/seo-agent/models", async original => ({ ...await original<typeof import("@/lib/seo-agent/models")>(), seoModels: () => ({ executor: "anthropic/claude-sonnet-5.5" }), gatewayProvider: () => () => state.model }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => {
  if (state.unavailableLifetime) throw new Error("private runtime detail");
  return { ctx: { waitUntil: (promise: Promise<unknown>) => state.waits.push(promise) } };
} }));
import { POST } from "@/app/api/gtm/chat/route";
import { gtmReservationUsd, gtmModelHistory } from "@/lib/gtm/chat/agent";
import { gtmTools } from "@/lib/gtm/chat/tools";
import { validateGtmMessages } from "@/lib/gtm/chat/types";
const WS = "11111111-1111-4111-8111-111111111111", CONV = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const input = { workspaceId: WS, conversationId: CONV, requestId: "turn-1", expectedRevision: 0, message: "Where should I focus?" };
const request = (signal?: AbortSignal) => new Request("https://contextfor.dev/api/gtm/chat", { method: "POST", body: JSON.stringify(input), signal });
const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 20, text: 20, reasoning: 0 } };
let upstream: ReadableStreamDefaultController<LanguageModelV4StreamPart>;
let model: MockLanguageModelV4;
beforeEach(() => {
  vi.clearAllMocks(); state.waits = []; state.unavailableLifetime = false;
  vi.stubEnv("VANTAGE_PAID_PROVIDERS_ENABLED", "true"); vi.stubEnv("VANTAGE_PAID_DAILY_BUDGET_USD", "5");
  state.authorize.mockResolvedValue({ ok: true, userId: "owner" }); state.consume.mockResolvedValue({ allowed: true });
  state.get.mockResolvedValue({ id: CONV });
  state.claim.mockResolvedValue({ claimed: true, token: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", state: "running" });
  state.load.mockResolvedValue({ revision: 1, messages: [{ id: "user", role: "user", parts: [{ type: "text", text: input.message }] }] });
  state.execute.mockResolvedValue([{ day: "today" }]); state.record.mockResolvedValue(true);
  state.finish.mockImplementation(async ({ message }: { message: unknown }) => { await validateGtmMessages([message]); });
  model = new MockLanguageModelV4({ doStream: async () => ({ stream: new ReadableStream({ start(controller) { upstream = controller; controller.enqueue({ type: "stream-start", warnings: [] }); controller.enqueue({ type: "text-start", id: "text" }); controller.enqueue({ type: "text-delta", id: "text", delta: "Grounded answer" }); } }) }) });
  state.model = model;
});
afterEach(() => vi.unstubAllEnvs());
async function finish() { upstream.enqueue({ type: "text-end", id: "text" }); upstream.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage }); upstream.close(); await Promise.all(state.waits); }

describe("GTM streaming SDK lifecycle and paid boundaries", () => {
  it("keeps the reservation open after Response creation and persists only after real SDK consumption and settlement", async () => {
    const response = await POST(request());
    await vi.waitFor(() => expect(model.doStreamCalls).toHaveLength(1));
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(state.record).not.toHaveBeenCalled(); expect(state.finish).not.toHaveBeenCalled();
    await finish();
    const wire = await response.text();
    expect(wire).toContain("Grounded answer"); expect(wire).toContain('"state":"complete"');
    expect(state.record).toHaveBeenCalledWith(expect.objectContaining({ provider: "gateway", action: "gtm_chat", unitCostUsd: 0.00022, ok: true }));
    expect(state.finish).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: WS, conversationId: CONV, interrupted: false, message: expect.objectContaining({ parts: expect.arrayContaining([{ type: "text", text: "Grounded answer", state: "done" }]) }) }));
    expect(state.record.mock.invocationCallOrder[0]).toBeLessThan(state.finish.mock.invocationCallOrder[0]!);
    expect(model.doStreamCalls[0]!.prompt.filter(m => m.role === "user")).toHaveLength(1);
    expect(state.release).not.toHaveBeenCalled();
  });
  it("charges the conservative bound and saves completed parts after an aborted attempt", async () => {
    const abort = new AbortController(), response = await POST(request(abort.signal));
    const reader = response.body!.getReader();
    let wire = "";
    while (!wire.includes("Grounded answer")) { const chunk = await reader.read(); if (chunk.done) throw new Error("Missing streamed text"); wire += new TextDecoder().decode(chunk.value); }
    abort.abort();
    await Promise.all(state.waits);
    while (true) { const chunk = await reader.read(); if (chunk.done) break; wire += new TextDecoder().decode(chunk.value); }
    expect(wire).not.toContain('"state":"complete"');
    expect(state.record).toHaveBeenCalledWith(expect.objectContaining({ unitCostUsd: gtmReservationUsd("anthropic/claude-sonnet-5.5"), ok: false }));
    expect(state.finish).toHaveBeenCalledWith(expect.objectContaining({ interrupted: true, message: expect.objectContaining({ parts: expect.arrayContaining([{ type: "text", text: "Grounded answer", state: "done" }]) }) }));
    expect(state.release).not.toHaveBeenCalled();
  });
  it("continues the single background UI consumer after the browser cancels its response body", async () => {
    const response = await POST(request());
    await vi.waitFor(() => expect(model.doStreamCalls).toHaveLength(1));
    const cancellation = response.body!.cancel();
    await finish(); await cancellation;
    expect(model.doStreamCalls).toHaveLength(1); expect(state.record).toHaveBeenCalledOnce(); expect(state.finish).toHaveBeenCalledOnce();
  });
  it("does not spend on a replay or competing generation", async () => {
    state.claim.mockResolvedValue({ claimed: false, state: "running" });
    expect((await POST(request())).status).toBe(409);
    expect(state.consume).not.toHaveBeenCalled(); expect(model.doStreamCalls).toHaveLength(0);
  });
  it("authorizes before claim, quota, model and database work", async () => {
    state.authorize.mockResolvedValue({ ok: false });
    expect((await POST(request())).status).toBe(403);
    for (const mock of [state.claim, state.consume, state.load, state.execute]) expect(mock).not.toHaveBeenCalled();
  });
  it("fails closed without a Worker lifetime context before claiming or billing", async () => {
    state.unavailableLifetime = true;
    const response = await POST(request()); expect(response.status).toBe(500); expect(await response.text()).not.toContain("private");
    expect(state.claim).not.toHaveBeenCalled(); expect(state.consume).not.toHaveBeenCalled();
  });
  it("does not dispatch when quota or provider reservation is denied", async () => {
    state.consume.mockResolvedValueOnce({ allowed: false });
    expect((await POST(request())).status).toBe(429); expect(model.doStreamCalls).toHaveLength(0);
    state.execute.mockResolvedValue([]);
    const response = await POST(request()); await Promise.all(state.waits);
    expect(await response.text()).not.toContain("Grounded answer"); expect(model.doStreamCalls).toHaveLength(0);
    expect(state.release).toHaveBeenCalledOnce();
  });
  it("does not refund question allowance or mark completion when recording cost fails after dispatch", async () => {
    state.record.mockResolvedValue(false);
    const response = await POST(request()); await vi.waitFor(() => expect(model.doStreamCalls).toHaveLength(1)); await finish();
    expect(await response.text()).not.toContain('"state":"complete"'); expect(state.release).not.toHaveBeenCalled();
    expect(state.finish).toHaveBeenCalledWith(expect.objectContaining({ interrupted: true }));
  });
  it("bounds aggregate streamed output and preserves valid partial history when the limit interrupts a response", async () => {
    const response = await POST(request());
    await vi.waitFor(() => expect(model.doStreamCalls).toHaveLength(1));
    upstream.enqueue({ type: "text-delta", id: "text", delta: "x".repeat(27_000) });
    await Promise.all(state.waits);
    expect(await response.text()).not.toContain("x".repeat(27_000));
    const saved = state.finish.mock.calls[0]![0];
    expect(saved.interrupted).toBe(true);
    await expect(validateGtmMessages([saved.message])).resolves.toHaveLength(1);
    expect(state.record).toHaveBeenCalledWith(expect.objectContaining({ unitCostUsd: gtmReservationUsd("anthropic/claude-sonnet-5.5"), ok: false }));
  });
  it("keeps one reservation through a denied tool loop and settles aggregate usage for both model steps", async () => {
    const stream = (chunks: LanguageModelV4StreamPart[]) => new ReadableStream<LanguageModelV4StreamPart>({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } });
    model = new MockLanguageModelV4({ doStream: [
      { stream: stream([{ type: "stream-start", warnings: [] }, { type: "tool-call", toolCallId: "scan-call", toolName: "request_scan", input: "{}" }, { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage }]) },
      { stream: stream([{ type: "stream-start", warnings: [] }, { type: "text-start", id: "reply" }, { type: "text-delta", id: "reply", delta: "Use the scan control to authorize a scan." }, { type: "text-end", id: "reply" }, { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage }]) },
    ] });
    state.model = model;
    state.execute.mockResolvedValueOnce([{ day: "today" }]).mockResolvedValue([]);
    const response = await POST(request()); await Promise.all(state.waits);
    expect(await response.text()).toContain("Use the scan control");
    expect(model.doStreamCalls).toHaveLength(2);
    expect(state.record).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ unitCostUsd: 0.00044, ok: true }));
  });
  it("fails closed for unpriced models and bounds history without doubling the latest question", () => {
    expect(() => gtmReservationUsd("unpriced/model")).toThrow("priced model");
    const history = gtmModelHistory(Array.from({ length: 30 }, (_, i) => ({ id: String(i), role: "user", parts: [{ type: "text", text: "x".repeat(4000) }] })));
    expect(history).toHaveLength(10); expect(history.every(m => typeof m.content === "string" && m.content.length === 2000)).toBe(true);
  });
  it("rejects a model scan request without the exact persisted owner grant", async () => {
    const tools = gtmTools({ workspaceId: WS, conversationId: CONV, signal: new AbortController().signal });
    await expect(tools.request_scan.execute!({}, { toolCallId: "invented", messages: [], context: {} })).rejects.toThrow("Scan confirmed sources");
    expect(state.execute).not.toHaveBeenCalled();
    const claimed = gtmTools({ workspaceId: WS, conversationId: CONV, signal: new AbortController().signal, turn: { requestId: "turn-1", token: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } });
    state.execute.mockResolvedValue([]);
    await expect(claimed.request_scan.execute!({}, { toolCallId: "invented", messages: [], context: {} })).rejects.toThrow("Scan confirmed sources");
  });
});
