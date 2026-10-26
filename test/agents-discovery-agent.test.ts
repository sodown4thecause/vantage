import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";

import { runDiscovery, type DiscoveryRunDeps } from "@/lib/agents/discovery";
import { PaidCallDeniedError } from "@/lib/providers/paid-call";

// Anything that reaches the database fails loudly: agents must never write, and the budget reader is injected.
vi.mock("@/lib/db/client", () => ({ getDb: () => { throw new Error("agents must not touch the database"); } }));

const MODEL_ID = "anthropic/claude-sonnet-5.5";
const usage = {
  inputTokens: { total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 200, text: 200, reasoning: 0 },
};
const STEP_COST = (1000 * 2 + 200 * 10) / 1_000_000; // sonnet-5.5 price table: $2 in, $10 out per million

const call = (toolName: string, input: unknown, id = `${toolName}-${Math.random()}`) =>
  ({ type: "tool-call" as const, toolCallId: id, toolName, input: JSON.stringify(input) });
const step = (...calls: ReturnType<typeof call>[]) => ({
  content: calls, finishReason: { unified: "tool-calls" as const, raw: "tool_calls" }, usage, warnings: [],
});
const done = { content: [{ type: "text" as const, text: "Done." }], finishReason: { unified: "stop" as const, raw: "stop" }, usage, warnings: [] };

const profile = {
  productName: "Vantage", description: "Finds the conversations where developers ask for tools like yours.",
  category: "Go-to-market tooling for AI developer products", audience: "Founders of AI developer tools", pricingTier: "paid",
  differentiators: ["Owner writes every reply", "Scores buying intent"], evidenceUrl: "https://contextfor.dev/",
};

function deps(over: Partial<DiscoveryRunDeps> & { script?: unknown[] } = {}) {
  const meta: Array<Record<string, unknown>> = [];
  const model = new MockLanguageModelV4({ doGenerate: (over.script ?? [done]) as never });
  const full: DiscoveryRunDeps = {
    model, modelId: MODEL_ID, env: {}, readSpent: async () => 0,
    runPaidCall: (async (m: Record<string, unknown>, work: () => Promise<{ value?: unknown; costUsd?: number; error?: Error }>) => {
      meta.push(m);
      const outcome = await work();
      meta.push({ costUsd: outcome.costUsd });
      if (outcome.error) throw outcome.error;
      return outcome.value;
    }) as never,
    tools: {
      fetchPage: async (url) => ({ value: { url, markdown: "# Vantage\nFinds buying-intent threads." }, cached: false }),
      search: async () => ({ value: { results: [] }, cached: false }),
    },
    ...over,
  };
  delete (full as { script?: unknown }).script;
  return { full, model, meta };
}

describe("runDiscovery", () => {
  it("runs a ToolLoopAgent through runPaidCall on the gateway, attributes cost to discovery and collects typed proposals", async () => {
    const script = [
      step(call("read_page", { url: "https://contextfor.dev/" })),
      step(call("propose_profile", profile)),
      step(
        call("propose_competitor", { domain: "syften.com", positioning: "Reddit alerts.", evidenceUrl: "https://syften.com/" }),
        call("propose_keyword", { keyword: "syften alternative", kind: "competitor", rationale: "Buyers compare.", evidenceUrl: "https://syften.com/" }),
        call("propose_source", { sourceType: "hn", name: "Profile: Hacker News", queries: ["ai", "startup", "tools"], rationale: "Founders hang out here.", relevanceScore: 0.9 }),
        call("propose_source", { sourceType: "hn", name: "HN: syften alternative", queries: ["syften alternative"], rationale: "Comparison threads.", relevanceScore: 0.8 }),
      ),
      done,
    ];
    const { full, meta } = deps({ script });
    const outcome = await runDiscovery({ workspaceId: "ws", productUrl: "https://contextfor.dev/" }, full);

    expect(outcome.status).toBe("complete");
    expect(outcome.profile?.productName).toBe("Vantage");
    expect(outcome.competitors.map((c) => c.domain)).toEqual(["syften.com"]);
    expect(outcome.keywords).toHaveLength(1);
    const accepted = outcome.sources.filter((s) => s.review.accepted).map((s) => s.proposal.name);
    const rejected = outcome.sources.filter((s) => !s.review.accepted).map((s) => s.proposal.name);
    expect(accepted).toEqual(["HN: syften alternative"]);
    expect(rejected).toEqual(["Profile: Hacker News"]);
    expect(outcome.results.filter((r) => r.kind === "source").map((r) => r.status)).toEqual(["rejected", "proposed"]);

    expect(meta[0]).toMatchObject({ provider: "gateway", action: "discovery_initial", context: { workspaceId: "ws", sourceKey: "discovery" } });
    expect(meta[1]!.costUsd).toBeCloseTo(STEP_COST * 4, 6);
    expect(outcome.modelCostUsd).toBeCloseTo(STEP_COST * 4, 6);
  });

  it("does not call the model when the workspace's discovery budget is used up", async () => {
    const { full, model } = deps({ readSpent: async () => 0.5 });
    await expect(runDiscovery({ workspaceId: "ws", productUrl: "https://contextfor.dev/" }, full))
      .rejects.toMatchObject({ name: "PaidCallDeniedError", code: "budget_exhausted" });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("ends the loop when the run's own spend reaches the remaining budget", async () => {
    // $0.03 left; one model step costs $0.004 but the first read costs $0.001 and the next searches cost $0.005 each.
    const script = Array.from({ length: 10 }, () => step(call("search_web", { query: "alternatives" })));
    const { full, model } = deps({ script, readSpent: async () => 0.47 });
    const outcome = await runDiscovery({ workspaceId: "ws", productUrl: "https://contextfor.dev/" }, full);
    expect(model.doGenerateCalls.length).toBeLessThan(10);
    expect(outcome.status).toBe("budget_exhausted");
  });

  it("uses the review cap and the review source key for a review run", async () => {
    const { full, meta } = deps({ readSpent: async () => 0 });
    await runDiscovery({ workspaceId: "ws", productUrl: "https://contextfor.dev/", kind: "review" }, full);
    expect(meta[0]).toMatchObject({ action: "discovery_review", context: { sourceKey: "discovery_review" } });
    expect(meta[0]!.estimateUsd as number).toBeLessThanOrEqual(0.05);
  });

  it("returns not_configured when the AI Gateway key is missing and no model is injected", async () => {
    const outcome = await runDiscovery({ workspaceId: "ws", productUrl: "https://contextfor.dev/" },
      { env: {}, readSpent: async () => 0 });
    expect(outcome.status).toBe("not_configured");
  });

  it("surfaces a paid-call denial from the provider as a denial, not a crash", async () => {
    const { full } = deps({ runPaidCall: (async () => { throw new PaidCallDeniedError("provider_disabled", "off"); }) as never });
    await expect(runDiscovery({ workspaceId: "ws", productUrl: "https://contextfor.dev/" }, full))
      .rejects.toBeInstanceOf(PaidCallDeniedError);
  });
});
