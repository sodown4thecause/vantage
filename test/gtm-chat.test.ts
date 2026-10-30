import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(), consume: vi.fn(), release: vi.fn(), profile: vi.fn(),
  queue: vi.fn(), detail: vi.fn(), get: vi.fn(), create: vi.fn(), append: vi.fn(),
  generate: vi.fn(), paid: vi.fn(), cost: vi.fn(), recordCost: vi.fn(), flushTelemetry: vi.fn(),
}));
vi.mock("@/lib/auth/workspace", () => ({ authorizeWorkspace: mocks.authorize }));
vi.mock("@/lib/plans/limits", () => ({ consume: mocks.consume, release: mocks.release }));
vi.mock("@/lib/profile/repository", () => ({ getLatestMonitoringProfile: mocks.profile }));
vi.mock("@/lib/opportunities/run", () => ({ listOpportunityQueue: mocks.queue, getOpportunityDetail: mocks.detail }));
vi.mock("@/lib/seo-agent/conversations", () => ({
  getConversation: mocks.get, createConversation: mocks.create, appendTurn: mocks.append,
  ConversationNotFoundError: class extends Error {},
}));
vi.mock("@/lib/seo-agent/models", () => ({
  seoModels: () => ({ executor: "test-model" }), gatewayProvider: () => () => "model", costOfUsage: mocks.cost,
}));
vi.mock("@/lib/providers/paid-call", () => ({
  runPaidCall: mocks.paid, PaidCallDeniedError: class extends Error {},
}));
vi.mock("@/lib/costs/ledger", () => ({ recordCost: mocks.recordCost }));
vi.mock("@/lib/analytics/ai-telemetry", () => ({
  flushPostHogAiTelemetry: mocks.flushTelemetry,
  posthogAiContext: (_userId: string | undefined, workspaceId: string) => ({ workspaceId }),
  posthogAiTelemetry: (functionId: string) => ({ isEnabled: true, functionId }),
}));
vi.mock("ai", async (original) => ({ ...await original<typeof import("ai")>(), generateText: mocks.generate }));

import { POST } from "@/app/api/gtm/chat/route";
import { TakoSearchMeter } from "@/lib/research/tako";

const WS = "11111111-1111-4111-8111-111111111111";
const CONV = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const actions = [
  { prompt: "Which buyer segment should I prioritize?", reason: "Focus outreach." },
  { prompt: "Which objection should I validate?", reason: "Improve positioning." },
  { prompt: "How should I measure this experiment?", reason: "Make the next decision." },
];
const evidence = {
  id: "opportunity", title: "Actual buyer conversation", summary: "A buyer is evaluating tools.",
  whyItMatters: "Good fit.", whyNow: "Recent conversation.", recommendedAction: "Read the thread.",
  evidence: [{ urlCanonical: "https://example.com/thread", contentMd: "Buyer question", title: "Thread" }],
};
const request = (body: object = {}) => new Request("https://contextfor.dev/api/gtm/chat", {
  method: "POST", body: JSON.stringify({ workspaceId: WS, message: "Where should I focus?", ...body }),
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("TAKO_SEARCH_USD", "0");
  mocks.authorize.mockResolvedValue({ ok: true });
  mocks.consume.mockResolvedValue({ allowed: true });
  mocks.profile.mockResolvedValue(null);
  mocks.queue.mockResolvedValue([{ id: "opportunity" }]);
  mocks.detail.mockResolvedValue(evidence);
  mocks.get.mockResolvedValue(null);
  mocks.create.mockResolvedValue({ id: CONV });
  mocks.append.mockResolvedValue({ id: CONV });
  mocks.generate.mockResolvedValue({ output: { answer: "Review the supplied conversation.", actions }, usage: { inputTokens: 10, outputTokens: 20 } });
  mocks.cost.mockReturnValue(0.001);
  mocks.recordCost.mockResolvedValue(true);
  mocks.flushTelemetry.mockResolvedValue(undefined);
  mocks.paid.mockImplementation(async (_meta, work) => {
    const result = await work();
    if (result.error) throw result.error;
    return result.value;
  });
});

afterEach(() => vi.unstubAllEnvs());

describe("GTM chat boundary", () => {
  it("refunds a failed atomic turn save without persisting separate messages", async () => {
    mocks.append.mockRejectedValue(new Error("private database failure"));
    expect((await POST(request())).status).toBe(500);
    expect(mocks.append).toHaveBeenCalledOnce();
    expect(mocks.append.mock.calls[0]![2]).toEqual({ content: "Where should I focus?" });
    expect(mocks.append.mock.calls[0]![3]).toMatchObject({ content: "Review the supplied conversation." });
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("logs only fixed failure categories and steps, including failed refunds", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mocks.detail.mockRejectedValue(new Error("secret evidence"));
      mocks.release.mockRejectedValue(new Error("secret refund"));
      expect((await POST(request())).status).toBe(500);
      expect(log.mock.calls).toEqual([
        ["[gtm chat] request failed", { step: "context", category: "unexpected" }],
        ["[gtm chat] request failed", { step: "refund", category: "unexpected" }],
      ]);
    } finally {
      log.mockRestore();
    }
  });

  it("authorizes before every query, quota mutation, and model call", async () => {
    mocks.authorize.mockResolvedValue({ ok: false });
    expect((await POST(request({ conversationId: CONV }))).status).toBe(403);
    for (const mock of [mocks.get, mocks.create, mocks.append, mocks.consume, mocks.profile, mocks.queue, mocks.detail, mocks.generate, mocks.paid]) {
      expect(mock).not.toHaveBeenCalled();
    }
  });

  it("fails closed for a foreign conversation before consuming quota", async () => {
    expect((await POST(request({ conversationId: CONV }))).status).toBe(404);
    expect(mocks.get).toHaveBeenCalledWith(WS, CONV);
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("does not continue an SEO conversation", async () => {
    mocks.get.mockResolvedValue({ id: CONV, messages: [{ role: "assistant", parts: { cards: [{ tool: "keywords" }] } }] });
    expect((await POST(request({ conversationId: CONV }))).status).toBe(404);
    expect(mocks.consume).not.toHaveBeenCalled();
  });

  it("scopes every query, meters once, and stores the exact three prompts and real evidence", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ conversationId: CONV, answer: "Review the supplied conversation.", actions, evidence: [evidence], blocks: [] });
    expect(mocks.profile).toHaveBeenCalledWith(WS);
    expect(mocks.queue).toHaveBeenCalledWith({ workspaceId: WS, limit: 5 });
    expect(mocks.detail).toHaveBeenCalledWith({ workspaceId: WS, opportunityId: "opportunity" });
    expect(mocks.consume).toHaveBeenCalledWith(WS, "seo_questions_per_month", 1, expect.any(Date));
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.append.mock.calls[0]!.slice(0, 3)).toEqual([WS, { title: "Where should I focus?" }, { content: "Where should I focus?" }]);
    const stored = mocks.append.mock.calls[0]![3];
    expect(mocks.append).toHaveBeenCalledOnce();
    expect(mocks.append.mock.calls[0]![2]).toEqual({ content: "Where should I focus?" });
    expect(stored.parts.cards[0]).toMatchObject({ tool: "gtm_journey", sandbox: false, data: { actions, evidence: [evidence] } });
    expect(stored.parts.followUps).toEqual({ seo: actions[0]!.prompt, geo: actions[1]!.prompt, content: actions[2]!.prompt });
    expect(mocks.paid).toHaveBeenCalledWith(expect.objectContaining({ context: { workspaceId: WS, sourceKey: "gtm" }, provider: "gateway", action: "gtm_chat" }), expect.any(Function));
    expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({
      maxRetries: 0,
      tools: { tako_search: expect.any(Object) },
      toolApproval: { tako_search: expect.any(Function) },
      stopWhen: expect.any(Function),
    }));
    expect(mocks.cost).toHaveBeenCalledWith("test-model", expect.objectContaining({ inputTokens: 10, outputTokens: 20 }));
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("returns Reddit evidence as conversation cards built from stored documents", async () => {
    const reddit = { ...evidence, evidence: [{ urlCanonical: "https://www.reddit.com/r/SaaS/comments/1/x/", platform: "reddit", contentMd: "Buyer question", title: "Thread", existingReplies: ["Try a spreadsheet first"], score: 12, subreddit: "SaaS" }] };
    mocks.detail.mockResolvedValue(reddit);
    const body = await (await POST(request())).json() as { blocks: unknown[] };
    expect(body.blocks).toEqual([expect.objectContaining({ type: "reddit_thread", subreddit: "SaaS", score: 12, comments: [{ body: "Try a spreadsheet first", score: null }] })]);
    expect(mocks.append.mock.calls[0]![3].parts.cards[0].data.blocks).toEqual(body.blocks);
  });

  it("renders Tako web citations and data cards in the workspace answer", async () => {
    const output = {
      web_results: [{ title: "Source report", url: "https://example.com/report", snippet: "A grounded excerpt." }],
      cards: [{ title: "Market value", webpage_url: "https://example.com/market", content: { card_data: { value: 42, unit: "USD" } } }],
    };
    mocks.generate.mockImplementationOnce(async (...args: unknown[]) => {
      const options = args[0] as Record<string, unknown>;
      const onStepFinish = options.onStepFinish as (event: never) => Promise<void>;
      await onStepFinish({ toolResults: [{ toolName: "tako_search", toolCallId: "gtm-tako", output }] } as never);
      return { output: { answer: "Review the supplied conversation.", actions }, usage: { inputTokens: 10, outputTokens: 20 } };
    });
    const response = await POST(request());
    const body = await response.json() as { blocks: Array<Record<string, unknown>> };
    expect(body.blocks).toEqual([
      expect.objectContaining({ type: "research_card", title: "Market value", value: "value: 42 · unit: USD", sourceUrl: "https://example.com/market" }),
      expect.objectContaining({ type: "research_card", title: "Source report", value: "A grounded excerpt.", sourceUrl: "https://example.com/report" }),
    ]);
    expect(mocks.append.mock.calls[0]![3].parts.cards[0].data.blocks).toEqual(body.blocks);
    expect(mocks.recordCost).toHaveBeenCalledWith(expect.objectContaining({ provider: "gateway", action: "tako_search", unitCostUsd: 0, sourceKey: "gtm" }));
  });

  it.each([0, 2, 4])("rejects %i follow-ups and releases the question", async (length) => {
    mocks.generate.mockResolvedValue({ output: { answer: "Answer", actions: Array.from({ length }, () => actions[0]) }, usage: {} });
    expect((await POST(request())).status).toBe(500);
    expect(mocks.release).toHaveBeenCalledWith(WS, "seo_questions_per_month", 1, expect.any(Date));
    expect(mocks.append).not.toHaveBeenCalled();
  });

  it("flushes AI telemetry even when research settlement fails", async () => {
    const settlePending = vi.spyOn(TakoSearchMeter.prototype, "settlePending")
      .mockRejectedValue(new Error("private settlement failure"));
    try {
      const response = await POST(request());
      expect(response.status).toBe(500);
      expect(mocks.flushTelemetry).toHaveBeenCalledOnce();
    } finally {
      settlePending.mockRestore();
    }
  });

  it("does not persist a response if cost settlement fails after generation", async () => {
    mocks.paid.mockImplementation(async (_meta, work) => { await work(); throw new Error("private metering detail"); });
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "request_failed" });
    expect(mocks.generate).toHaveBeenCalledOnce();
    expect(mocks.append).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("does not call the model when quota consumption fails", async () => {
    mocks.consume.mockRejectedValue(new Error("private database detail"));
    expect((await POST(request())).status).toBe(500);
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("returns the shared quota notice without model work when exhausted", async () => {
    mocks.consume.mockResolvedValue({ allowed: false });
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: "quota_exhausted", message: expect.stringContaining("share") });
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it.each(["", " ", "x".repeat(2001)])("rejects invalid message length", async (message) => {
    expect((await POST(request({ message }))).status).toBe(400);
    expect(mocks.authorize).not.toHaveBeenCalled();
  });

  it("returns no invented evidence for an empty queue", async () => {
    mocks.queue.mockResolvedValue([]);
    const response = await POST(request());
    expect((await response.json()).evidence).toEqual([]);
    expect(mocks.detail).not.toHaveBeenCalled();
  });

  it("continues only GTM history and bounds the model context", async () => {
    mocks.get.mockResolvedValue({ id: CONV, messages: Array.from({ length: 30 }, (_, index) => ({
      role: index % 2 ? "assistant" : "user", content: "x".repeat(4000), status: "complete",
      parts: { cards: [{ tool: "gtm_journey" }] },
    })) });
    expect((await POST(request({ conversationId: CONV }))).status).toBe(200);
    expect(mocks.create).not.toHaveBeenCalled();
    const context = JSON.parse(mocks.generate.mock.calls[0]![0].prompt);
    expect(context.history).toHaveLength(10);
    expect(context.history.every((item: { content: string }) => item.content.length === 3000)).toBe(true);
  });

  it("drops unavailable details rather than replacing them with generated evidence", async () => {
    mocks.detail.mockResolvedValue(null);
    const response = await POST(request());
    expect((await response.json()).evidence).toEqual([]);
    const context = JSON.parse(mocks.generate.mock.calls[0]![0].prompt);
    expect(context.evidence).toEqual([]);
  });

  it("releases quota without calling the model when grounded context cannot be read", async () => {
    mocks.detail.mockRejectedValue(new Error("private read failure"));
    expect((await POST(request())).status).toBe(500);
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("rejects duplicate prompts even when their case and spacing differ", async () => {
    mocks.generate.mockResolvedValue({ output: {
      answer: "Answer", actions: [actions[0], { ...actions[0], prompt: actions[0]!.prompt.toUpperCase().replaceAll(" ", "  ") }, actions[2]],
    }, usage: {} });
    expect((await POST(request())).status).toBe(500);
    expect(mocks.append).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("returns a generic error even if releasing quota also fails", async () => {
    mocks.detail.mockRejectedValue(new Error("private read failure"));
    mocks.release.mockRejectedValue(new Error("private release failure"));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "request_failed" });
  });

  it("preserves source URLs while bounding model evidence excerpts", async () => {
    mocks.detail.mockResolvedValue({ ...evidence, evidence: [{
      ...evidence.evidence[0], contentMd: "x".repeat(20000),
    }] });
    expect((await POST(request())).status).toBe(200);
    const context = JSON.parse(mocks.generate.mock.calls[0]![0].prompt);
    expect(context.evidence[0].sources[0].url).toBe("https://example.com/thread");
    expect(context.evidence[0].sources[0].excerpt).toHaveLength(2000);
    expect(mocks.generate.mock.calls[0]![0].instructions).toContain("actions[0]");
  });
});
