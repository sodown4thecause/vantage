import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recordCost: vi.fn(async () => true),
}));

vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/costs/ledger", () => ({ recordCost: mocks.recordCost }));
vi.mock("@/lib/dataforseo/config", () => ({ dataForSeoAvailable: () => true, dataForSeoConfig: () => null }));
vi.mock("@/lib/providers/paid-call", () => ({
  runPaidCall: async (_meta: unknown, work: () => Promise<{ value?: unknown; error?: unknown }>) => {
    const outcome = await work();
    if (outcome.error) throw outcome.error;
    return outcome.value;
  },
  PaidCallDeniedError: class extends Error {},
  isPaidCallDenied: () => false,
}));

import { TakoSearchMeter } from "@/lib/research/tako";
import { EndpointAttemptBudget, QuestionBudget } from "@/lib/seo-agent/budget";
import { collectEvidence, packetFromContext } from "@/lib/seo-agent/collect";
import { addCard, runGated, type ToolContext } from "@/lib/seo-agent/tools/shared";

const WS = "11111111-1111-4111-8111-111111111111";
const PROFILE = {
  productDomain: "acme.dev", productName: "Acme", competitor: "rival.io", topic: "ci caching",
  description: "Build cache", targetCustomer: "platform engineers",
} as never;

function makeCtx(): ToolContext {
  return {
    workspaceId: WS, budget: new QuestionBudget(5, []), attempts: new EndpointAttemptBudget(),
    brandDomains: [], cards: [], evidence: [], notices: [],
  };
}

const collectInput = (intent: "backlinks" | "serp" = "backlinks") => ({
  workspaceId: WS, question: "q", history: [], intent, profile: PROFILE,
  classificationHints: { domains: [], keywords: [], engines: [] },
});

const generated = (work: (ctx: ToolContext) => Promise<void> | void, ctx: ToolContext) =>
  vi.fn(async () => {
    await work(ctx);
    return { finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1, inputTokenDetails: {} } };
  });

beforeEach(() => {
  vi.stubEnv("AI_GATEWAY_API_KEY", "gateway-test-key");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("collectEvidence", () => {
  it("settles pending Tako reservations when the collector call throws", async () => {
    const settle = vi.spyOn(TakoSearchMeter.prototype, "settlePending").mockResolvedValue(undefined);
    const boom = new Error("provider down");
    const generateText = vi.fn(async () => { throw boom; });

    await expect(collectEvidence(collectInput(), makeCtx(), "model-x", { deps: { generateText: generateText as never } }))
      .rejects.toBe(boom);
    expect(settle).toHaveBeenCalledOnce();
  });

  it("gives the summarizer the full list total even though the stored card is cut", async () => {
    const ctx = makeCtx();
    const rows = Array.from({ length: 1_000 }, (_, i) => ({ domain: `d${i}.com`, rank: i, backlinks: 1, spamScore: 0, firstSeen: null }));
    const generateText = generated((c) => addCard(c, { tool: "referring_domains", title: "Referring domains", cached: false, data: rows }), ctx);

    const { packet } = await collectEvidence(collectInput(), ctx, "model-x", { deps: { generateText: generateText as never } });

    expect((ctx.cards[0]!.data as unknown[]).length).toBeLessThan(1_000);
    expect(packet.entries[0]!.data).toMatchObject({ total: 1_000 });
    expect(packetFromContext(ctx, "q", [], PROFILE).entries[0]!.data).toMatchObject({ total: 1_000 });
  });

  it("labels each search result with the lookup that produced it", async () => {
    const ctx = makeCtx();
    const serp = (title: string) => ({ organic: [{ position: 1, domain: "a.com", title, url: "https://a.com/" }], hasAiOverview: false });
    const lookup = (keyword: string) => runGated(ctx, {
      tool: "google_serp", title: `Google results — ${keyword}`, input: { keyword }, credits: 1,
      peek: async () => serp(`about ${keyword}`),
      fetch: async () => ({ value: serp(`about ${keyword}`), cached: true }),
    });
    const generateText = generated(async () => { await lookup("ci caching"); await lookup("build cache"); }, ctx);

    const { packet } = await collectEvidence(collectInput("serp"), ctx, "model-x", { deps: { generateText: generateText as never } });

    expect(packet.entries.map((entry) => entry.input)).toEqual([{ keyword: "ci caching" }, { keyword: "build cache" }]);
  });
});
