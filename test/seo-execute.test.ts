import { createUIMessageStream, type UIMessageChunk } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class PaidCallDeniedError extends Error {
    constructor(public readonly code: "provider_disabled" | "budget_exhausted" | "access_pending", message: string) {
      super(message);
      this.name = "PaidCallDeniedError";
    }
  }
  return {
    PaidCallDeniedError,
    paid: vi.fn(),
    charged: [] as Array<number | undefined>,
    dataForSeo: vi.fn(() => true),
    peekKeywordIdeas: vi.fn(async () => null),
  };
});

vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/providers/paid-call", () => ({
  runPaidCall: mocks.paid,
  PaidCallDeniedError: mocks.PaidCallDeniedError,
}));
vi.mock("@/lib/dataforseo/config", () => ({ dataForSeoAvailable: () => mocks.dataForSeo() }));
vi.mock("@/lib/dataforseo/labs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/dataforseo/labs")>()),
  peekKeywordIdeas: mocks.peekKeywordIdeas,
}));

import { PaidCallDeniedError } from "@/lib/providers/paid-call";
import { runAgent, storedStatus, type AgentOutcome, type AgentProfile, type AgentRunInput } from "@/lib/seo-agent/execute";
import { costOfUsage } from "@/lib/seo-agent/models";
import { systemPrompt } from "@/lib/seo-agent/prompt";
import { fallbackFollowUps, profileContext } from "@/lib/seo-agent/suggestions";
import { stepCountIs } from "ai";

const WS = "11111111-1111-4111-8111-111111111111";
const CONV = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EXECUTOR = "anthropic/claude-sonnet-5.5";
const CLASSIFIER = "reflection/beam";
const FALLBACK = "anthropic/claude-fallback-test";
const DATA_TOOLS = [
  "ai_keyword_volume", "anchors", "backlink_gap", "backlink_summary", "competitor_domains", "google_serp",
  "keyword_gap", "keyword_ideas", "keyword_overview", "llm_response", "ranked_keywords", "referring_domains",
];

const PROFILE: AgentProfile = {
  ...profileContext({ productUrl: "https://acme.dev", competitors: ["https://rival.io"], topics: ["ci caching"] }),
  description: "Build cache for CI",
  targetCustomer: "platform engineers",
};

type Script = {
  chunks: UIMessageChunk[] | ((options: FakeOptions) => Promise<UIMessageChunk[]>);
  finishReason?: string;
  usage?: { inputTokens: number; outputTokens: number; inputTokenDetails: { cacheReadTokens: number } };
};
// The SDK option bag is loosely typed; the fakes read only the fields the executor passes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FakeOptions = Record<string, any>;

/** Streams one scripted attempt per call; the last script repeats. Calls onFinish like the SDK does before it closes. */
function fakeStreamText(scripts: Script[]) {
  let call = 0;
  return vi.fn((options: FakeOptions) => {
    const script = scripts[Math.min(call, scripts.length - 1)]!;
    call += 1;
    return {
      finishReason: Promise.resolve(script.finishReason ?? "stop"),
      toUIMessageStream: () => new ReadableStream<UIMessageChunk>({
        async start(controller) {
          const chunks = typeof script.chunks === "function" ? await script.chunks(options) : script.chunks;
          for (const chunk of chunks) controller.enqueue(chunk);
          options.onFinish?.({
            usage: script.usage ?? { inputTokens: 1000, outputTokens: 100, inputTokenDetails: { cacheReadTokens: 0 } },
          });
          controller.close();
        },
      }),
    };
  });
}

const text = (value: string): UIMessageChunk[] => [
  { type: "text-start", id: "t1" },
  { type: "text-delta", id: "t1", delta: value },
  { type: "text-end", id: "t1" },
];
const STEP_START = { type: "start-step" } as UIMessageChunk;
const STEP_FINISH = { type: "finish-step" } as UIMessageChunk;
const ERROR = { type: "error", errorText: "boom" } as UIMessageChunk;

function fakeGenerateText(impl?: (options: FakeOptions) => Promise<unknown>) {
  const answer: (options: FakeOptions) => Promise<unknown> = async () => ({
    output: { seo: "Which keywords hold rank?", geo: "Does ChatGPT cite docs?", content: "Outline a comparison post." },
    usage: { inputTokens: 500, outputTokens: 50, inputTokenDetails: { cacheReadTokens: 0 } },
  });
  return vi.fn(impl ?? answer);
}

function input(overrides: Partial<AgentRunInput> = {}): AgentRunInput {
  return {
    workspaceId: WS,
    conversationId: CONV,
    question: "Which keywords should we target?",
    history: [],
    classification: { intent: "keywords", domains: [], keywords: [], engines: [] },
    profile: PROFILE,
    ...overrides,
  };
}

/** Runs the answer through a real UI message stream and returns the outcome plus every chunk written. */
async function drain(run: { write: (writer: never) => Promise<AgentOutcome> }) {
  let outcome: AgentOutcome | undefined;
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      outcome = await run.write(writer as never);
    },
  });
  const chunks: UIMessageChunk[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return { outcome: outcome!, chunks };
}

const textOf = (chunks: UIMessageChunk[]) => chunks
  .flatMap((chunk) => (chunk.type === "text-delta" ? [chunk.delta] : []))
  .join("");

beforeEach(() => {
  mocks.paid.mockReset();
  mocks.charged = [];
  mocks.paid.mockImplementation(async (_meta: unknown, work: () => Promise<{ value?: unknown; error?: Error; costUsd?: number }>) => {
    const result = await work();
    mocks.charged.push(result.costUsd);
    if (result.error) throw result.error;
    return result.value;
  });
  mocks.dataForSeo.mockReset();
  mocks.dataForSeo.mockReturnValue(true);
  mocks.peekKeywordIdeas.mockReset();
  mocks.peekKeywordIdeas.mockResolvedValue(null);
  vi.stubEnv("AI_GATEWAY_API_KEY", "gateway-test-key");
  vi.stubEnv("SEO_AGENT_MODEL", "");
  vi.stubEnv("SEO_CLASSIFIER_MODEL", "");
  vi.stubEnv("SEO_CLASSIFIER_SPEED", "");
  vi.stubEnv("SEO_AGENT_FALLBACK_MODEL", "");
  vi.stubEnv("SEO_AGENT_AUTO_CREDITS", "");
  vi.stubEnv("SEO_AGENT_GEO_ALWAYS_ASK", "");
  vi.stubEnv("SEO_MODEL_PRICES_JSON", "");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("systemPrompt", () => {
  it("names the untrusted-data rule and the follow-up tool, and describes list results as rows of total", () => {
    const prompt = systemPrompt(PROFILE);
    expect(prompt).toContain("untrusted");
    expect(prompt).toContain("suggest_follow_ups");
    expect(prompt).toMatch(/\{ rows, total \}/);
    expect(prompt).toContain("25");
  });

  it("tells the model how to label live and cached data, and never to invent a date", () => {
    const prompt = systemPrompt(PROFILE);
    expect(prompt).toContain("data: { rows, total }");
    expect(prompt).toContain('For source "live", call the figures live data (as of today).');
    expect(prompt).toContain(
      'For source "cached", call the figures cached data (up to 30 days old for backlinks, keywords and AI search volume; up to 7 days for Google results and AI answers).',
    );
    expect(prompt).toContain("Never invent a specific date.");
    expect(prompt).not.toContain("data date");
    expect(prompt).not.toContain("fetched");
  });

  it("asks llm_response prompts to be neutral questions that never carry the company or profile", () => {
    const prompt = systemPrompt(PROFILE);
    expect(prompt).toContain("neutral question a real user would ask");
    expect(prompt).toContain("Never put the workspace's own company name or profile text in it.");
  });

  it("puts the profile block last so the static instructions stay cacheable", () => {
    const prompt = systemPrompt(PROFILE);
    const block = prompt.indexOf("Workspace profile");
    expect(block).toBeGreaterThan(0);
    expect(prompt.slice(block)).toContain("acme.dev");
    expect(prompt.slice(0, block)).not.toContain("acme.dev");
  });
});

describe("runAgent: tool path", () => {
  it("streams with the executor, a six-step cap, no SDK retries and the cached system prompt", async () => {
    vi.stubEnv("SEO_AGENT_FALLBACK_MODEL", FALLBACK);
    const streamText = fakeStreamText([{ chunks: text("Done."), finishReason: "stop" }]);
    const run = await runAgent(input(), { deps: { streamText: streamText as never, generateText: fakeGenerateText() as never } });
    await drain(run);

    const options = streamText.mock.calls[0]![0] as FakeOptions;
    expect(options.model.modelId).toBe(EXECUTOR);
    expect(options.maxRetries).toBe(0);
    expect(options.providerOptions).toEqual({ gateway: { models: [FALLBACK] } });
    expect(options.system).toMatchObject({
      role: "system",
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    });
    expect(options.system.content).toContain("untrusted");
    expect(options.stopWhen({ steps: Array(5).fill({}) })).toBe(false);
    expect(options.stopWhen({ steps: Array(6).fill({}) })).toBe(true);
    expect(stepCountIs(6)({ steps: Array(6).fill({}) })).toBe(true);
  });

  it("gives an intent 'all' classification every data tool plus suggest_follow_ups", async () => {
    const streamText = fakeStreamText([{ chunks: text("Done."), finishReason: "stop" }]);
    const run = await runAgent(input({ classification: { intent: "all", domains: [], keywords: [], engines: [] } }), {
      deps: { streamText: streamText as never, generateText: fakeGenerateText() as never },
    });
    await drain(run);
    const names = Object.keys((streamText.mock.calls[0]![0] as FakeOptions).tools).sort();
    expect(names).toEqual([...DATA_TOOLS, "suggest_follow_ups"].sort());
  });

  it("gives only suggest_follow_ups and a notice when DataForSEO is not set up", async () => {
    mocks.dataForSeo.mockReturnValue(false);
    const streamText = fakeStreamText([{ chunks: text("From general knowledge."), finishReason: "stop" }]);
    const run = await runAgent(input({ classification: { intent: "backlinks", domains: ["rival.io"], keywords: [], engines: [] } }), {
      deps: { streamText: streamText as never, generateText: fakeGenerateText() as never },
    });
    const { outcome } = await drain(run);
    expect(Object.keys((streamText.mock.calls[0]![0] as FakeOptions).tools)).toEqual(["suggest_follow_ups"]);
    expect(outcome.notices).toEqual(["SEO data is not set up yet."]);
    expect(outcome.plan).toEqual([]);
  });

  it("uses the follow-up the model records through suggest_follow_ups", async () => {
    const streamText = fakeStreamText([{
      chunks: async (options) => {
        await options.tools.suggest_follow_ups.execute(
          { seo: "Which keywords hold rank?", geo: "Does ChatGPT cite docs?", content: "Outline a comparison post." },
          { toolCallId: "f1", messages: [] },
        );
        return text("Answer.");
      },
      finishReason: "stop",
    }]);
    const run = await runAgent(input(), { deps: { streamText: streamText as never, generateText: fakeGenerateText() as never } });
    const { outcome } = await drain(run);
    expect(outcome.followUps).toEqual({
      seo: "Which keywords hold rank?", geo: "Does ChatGPT cite docs?", content: "Outline a comparison post.",
    });
  });

  it("falls back to three template follow-ups when the model skips suggest_follow_ups", async () => {
    const streamText = fakeStreamText([{ chunks: text("Answer without follow-ups."), finishReason: "stop" }]);
    const run = await runAgent(input(), { deps: { streamText: streamText as never, generateText: fakeGenerateText() as never } });
    const { outcome } = await drain(run);
    expect(outcome.followUps).toEqual(fallbackFollowUps(PROFILE, "keywords"));
    expect(Object.keys(outcome.followUps).sort()).toEqual(["content", "geo", "seo"]);
  });

  it("turns a call that needs approval into a plan and status-bearing outcome", async () => {
    vi.stubEnv("SEO_AGENT_AUTO_CREDITS", "0");
    const streamText = fakeStreamText([{
      chunks: async (options) => {
        await options.tools.keyword_ideas.execute({ keywords: ["ci caching"] }, { toolCallId: "k1", messages: [] });
        return text("I need approval to run that.");
      },
      finishReason: "stop",
    }]);
    const run = await runAgent(input(), { deps: { streamText: streamText as never, generateText: fakeGenerateText() as never } });
    const { outcome } = await drain(run);
    expect(outcome.plan).toEqual([{ tool: "keyword_ideas", input: { keywords: ["ci caching"] }, credits: 1 }]);
    expect(outcome.status).toBe("complete");
  });

  it("records the model cost through one gateway reservation for seo_execute", async () => {
    const streamText = fakeStreamText([{
      chunks: text("Done."),
      finishReason: "stop",
      usage: { inputTokens: 1000, outputTokens: 100, inputTokenDetails: { cacheReadTokens: 0 } },
    }]);
    const run = await runAgent(input(), { deps: { streamText: streamText as never, generateText: fakeGenerateText() as never } });
    await drain(run);
    expect(mocks.paid).toHaveBeenCalledTimes(1);
    expect(mocks.paid.mock.calls[0]![0]).toMatchObject({
      context: { workspaceId: WS, sourceKey: "seo" },
      provider: "gateway",
      action: "seo_execute",
      estimateUsd: 0.08,
    });
    expect(mocks.charged).toEqual([costOfUsage(EXECUTOR, { inputTokens: 1000, outputTokens: 100, cachedInputTokens: 0 })]);
  });

  it("rejects before any model call when the paid reservation is denied", async () => {
    mocks.paid.mockRejectedValueOnce(new PaidCallDeniedError("budget_exhausted", "Daily provider budget exhausted."));
    const streamText = fakeStreamText([{ chunks: text("Never sent."), finishReason: "stop" }]);
    await expect(runAgent(input(), { deps: { streamText: streamText as never, generateText: fakeGenerateText() as never } }))
      .rejects.toBeInstanceOf(PaidCallDeniedError);
    expect(streamText).not.toHaveBeenCalled();
  });

  it("rejects an already aborted request before reserving anything", async () => {
    const controller = new AbortController();
    controller.abort();
    const streamText = fakeStreamText([{ chunks: text("Never sent."), finishReason: "stop" }]);
    await expect(runAgent(input(), {
      signal: controller.signal,
      deps: { streamText: streamText as never, generateText: fakeGenerateText() as never },
    })).rejects.toThrow();
    expect(mocks.paid).not.toHaveBeenCalled();
    expect(streamText).not.toHaveBeenCalled();
  });

  it("retries once on the fallback model after a refusal with no text, discarding the refused attempt", async () => {
    vi.stubEnv("SEO_AGENT_FALLBACK_MODEL", FALLBACK);
    const streamText = fakeStreamText([
      { chunks: [STEP_START, STEP_FINISH], finishReason: "content-filter" },
      { chunks: [STEP_START, ...text("Here is the answer."), STEP_FINISH], finishReason: "stop" },
    ]);
    const run = await runAgent(input(), { deps: { streamText: streamText as never, generateText: fakeGenerateText() as never } });
    const { outcome, chunks } = await drain(run);

    expect(streamText).toHaveBeenCalledTimes(2);
    expect((streamText.mock.calls[1]![0] as FakeOptions).model.modelId).toBe(FALLBACK);
    expect(outcome.status).toBe("complete");
    expect(textOf(chunks)).toBe("Here is the answer.");
    expect(chunks.filter((chunk) => chunk.type === "start-step")).toHaveLength(1);
  });

  it("reports a refusal when the fallback also refuses, and does not try a third model call", async () => {
    vi.stubEnv("SEO_AGENT_FALLBACK_MODEL", FALLBACK);
    const streamText = fakeStreamText([{ chunks: [STEP_START, STEP_FINISH], finishReason: "content-filter" }]);
    const run = await runAgent(input(), { deps: { streamText: streamText as never, generateText: fakeGenerateText() as never } });
    const { outcome, chunks } = await drain(run);
    expect(streamText).toHaveBeenCalledTimes(2);
    expect(outcome.status).toBe("refused");
    expect(textOf(chunks)).toBe("I can't answer that one. Try rephrasing.");
  });

  it("reports a refusal without retrying when no fallback model is set", async () => {
    const streamText = fakeStreamText([{ chunks: [STEP_START, STEP_FINISH], finishReason: "content-filter" }]);
    const run = await runAgent(input(), { deps: { streamText: streamText as never, generateText: fakeGenerateText() as never } });
    const { outcome } = await drain(run);
    expect(streamText).toHaveBeenCalledTimes(1);
    expect(outcome.status).toBe("refused");
  });

  it("fails with a generic message and no content when the model errors before any text", async () => {
    const streamText = fakeStreamText([{ chunks: [STEP_START, ERROR] }]);
    const run = await runAgent(input(), { deps: { streamText: streamText as never, generateText: fakeGenerateText() as never } });
    const { outcome, chunks } = await drain(run);
    expect(outcome.status).toBe("failed");
    expect(outcome.content).toBe("");
    expect(textOf(chunks)).toBe("Something went wrong. You weren't charged a question.");
    expect(mocks.charged).toEqual([undefined]);
  });

  it("keeps the partial answer as incomplete when the model errors after text started", async () => {
    const streamText = fakeStreamText([{ chunks: [...text("Partial "), ERROR] }]);
    const run = await runAgent(input(), { deps: { streamText: streamText as never, generateText: fakeGenerateText() as never } });
    const { outcome } = await drain(run);
    expect(outcome.status).toBe("incomplete");
    expect(outcome.content).toBe("Partial ");
  });

  it("runs only the approved calls, with no new credits, when an approved plan is run", async () => {
    const approved = [{ tool: "keyword_ideas", input: { keywords: ["ci caching"] }, credits: 1 }];
    const streamText = fakeStreamText([{ chunks: text("From the results."), finishReason: "stop" }]);
    const run = await runAgent(input({ approved }), { deps: { streamText: streamText as never, generateText: fakeGenerateText() as never } });
    const { outcome } = await drain(run);
    const options = streamText.mock.calls[0]![0] as FakeOptions;
    expect(Object.keys(options.tools).sort()).toEqual(["keyword_ideas", "suggest_follow_ups"]);
    const last = options.messages.at(-1);
    expect(last.role).toBe("user");
    expect(last.content).toContain("keyword_ideas");
    expect(last.content).toContain("ci caching");
    expect(outcome.plan).toEqual([]);
  });
});

describe("runAgent: concept and out-of-scope path", () => {
  it.each(["concept", "out_of_scope"] as const)("answers %s with the classifier model and no tools, then records follow-ups from one structured call", async (intent) => {
    const streamText = fakeStreamText([{ chunks: text("Crawl budget is the pages a bot will fetch."), finishReason: "stop" }]);
    const generateText = fakeGenerateText();
    const run = await runAgent(input({ classification: { intent, domains: [], keywords: [], engines: [] } }), {
      deps: { streamText: streamText as never, generateText: generateText as never },
    });
    const { outcome, chunks } = await drain(run);

    const options = streamText.mock.calls[0]![0] as FakeOptions;
    expect(options.model.modelId).toBe(CLASSIFIER);
    expect(options.tools).toEqual({});
    expect(options.maxRetries).toBe(0);
    expect(textOf(chunks)).toBe("Crawl budget is the pages a bot will fetch.");

    expect(generateText).toHaveBeenCalledTimes(1);
    const structured = generateText.mock.calls[0]![0] as FakeOptions;
    expect(structured.output).toBeDefined();
    expect(structured.maxRetries).toBe(0);
    expect(mocks.paid.mock.calls.map((call) => (call[0] as { action: string }).action)).toEqual(["seo_execute", "seo_classify"]);
    expect(outcome.followUps).toEqual({
      seo: "Which keywords hold rank?", geo: "Does ChatGPT cite docs?", content: "Outline a comparison post.",
    });
  });

  it("falls back to template follow-ups when the structured follow-up call fails", async () => {
    const streamText = fakeStreamText([{ chunks: text("An answer."), finishReason: "stop" }]);
    const generateText = fakeGenerateText(async () => { throw new Error("schema"); });
    const run = await runAgent(input({ classification: { intent: "concept", domains: [], keywords: [], engines: [] } }), {
      deps: { streamText: streamText as never, generateText: generateText as never },
    });
    const { outcome } = await drain(run);
    expect(outcome.followUps).toEqual(fallbackFollowUps(PROFILE, "concept"));
  });
});

describe("runAgent: the final message metadata", () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it("ends the stream with the run's message id, stored status and the answer's parts", async () => {
    const streamText = fakeStreamText([{ chunks: text("Here are the keywords.") }]);
    const run = await runAgent(input(), { deps: { streamText: streamText as never, generateText: fakeGenerateText() as never } });
    const { outcome, chunks } = await drain(run);

    const metadata = chunks.filter((chunk) => chunk.type === "message-metadata").at(-1);
    expect(metadata).toEqual({
      type: "message-metadata",
      messageMetadata: {
        conversationId: CONV,
        messageId: run.messageId,
        status: "complete",
        cards: outcome.cards,
        followUps: outcome.followUps,
        plan: outcome.plan,
        notices: outcome.notices,
        creditsUsed: outcome.creditsUsed,
      },
    });
  });

  it("gives every run its own uuid message id", async () => {
    const streamText = fakeStreamText([{ chunks: text("One.") }, { chunks: text("Two.") }]);
    const deps = { streamText: streamText as never, generateText: fakeGenerateText() as never };
    const first = await runAgent(input(), { deps });
    const second = await runAgent(input(), { deps });
    expect(first.messageId).toMatch(UUID);
    expect(second.messageId).toMatch(UUID);
    expect(second.messageId).not.toBe(first.messageId);
  });
});

describe("storedStatus", () => {
  const base: AgentOutcome = { status: "complete", content: "Answer.", cards: [], followUps: { seo: "a", geo: "b", content: "c" }, plan: [], notices: [], creditsUsed: 0 };

  it("is complete for an answer with no plan", () => {
    expect(storedStatus(base)).toBe("complete");
  });

  it("is needs_approval for an answer that holds a plan", () => {
    expect(storedStatus({ ...base, plan: [{ tool: "llm_response", input: {}, credits: 2 }] })).toBe("needs_approval");
  });

  it("is incomplete for a partial, failed or refused answer, even if it held a plan", () => {
    const plan = [{ tool: "llm_response", input: {}, credits: 2 }];
    expect(storedStatus({ ...base, status: "incomplete", plan })).toBe("incomplete");
    expect(storedStatus({ ...base, status: "failed", content: "", plan })).toBe("incomplete");
    expect(storedStatus({ ...base, status: "refused", content: "" })).toBe("incomplete");
  });
});
