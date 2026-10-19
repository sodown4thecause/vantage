import type { generateText } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class PaidCallDeniedError extends Error {
    constructor(public readonly code: "provider_disabled" | "budget_exhausted" | "access_pending", message: string) {
      super(message);
      this.name = "PaidCallDeniedError";
    }
  }
  return { PaidCallDeniedError, paid: vi.fn(), charged: [] as Array<number | undefined> };
});
vi.mock("@/lib/providers/paid-call", () => ({
  runPaidCall: mocks.paid,
  PaidCallDeniedError: mocks.PaidCallDeniedError,
}));

import { PaidCallDeniedError } from "@/lib/providers/paid-call";
import { classifierProviderOptions, costOfUsage, seoModels } from "@/lib/seo-agent/models";
import { classifyQuestion, INTENTS } from "@/lib/seo-agent/classify";

type FakeGenerate = (options: Record<string, unknown>) => Promise<unknown>;

function fakeGenerate(impl: FakeGenerate) {
  const fn = vi.fn(impl);
  return { fn, deps: { generateText: fn as unknown as typeof generateText } };
}

const validOutput = {
  intent: "backlinks",
  domains: ["example.com"],
  keywords: ["link building"],
  engines: ["claude"],
};
const usage = { inputTokens: 1200, outputTokens: 80, inputTokenDetails: { cacheReadTokens: 0 } };
const ALL = { intent: "all", domains: [], keywords: [], engines: [] };

beforeEach(() => {
  mocks.paid.mockReset();
  mocks.charged = [];
  mocks.paid.mockImplementation(async (_meta: unknown, work: () => Promise<{ value: unknown; costUsd?: number }>) => {
    const result = await work();
    mocks.charged.push(result.costUsd);
    return result.value;
  });
  vi.stubEnv("AI_GATEWAY_API_KEY", "gateway-test-key");
  vi.stubEnv("SEO_CLASSIFIER_SPEED", "");
  vi.stubEnv("SEO_CLASSIFIER_MODEL", "");
  vi.stubEnv("SEO_AGENT_MODEL", "");
  vi.stubEnv("SEO_MODEL_PRICES_JSON", "");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("seoModels", () => {
  it("returns null when the gateway key is blank", () => {
    expect(seoModels({})).toBeNull();
    expect(seoModels({ AI_GATEWAY_API_KEY: "   " })).toBeNull();
  });

  it("defaults the executor to Sonnet 5.5 and the classifier to reflection/beam", () => {
    expect(seoModels({ AI_GATEWAY_API_KEY: "k" })).toEqual({
      executor: "anthropic/claude-sonnet-5.5",
      classifier: "reflection/beam",
      fallback: null,
    });
  });

  it("reads model ids from env", () => {
    expect(seoModels({
      AI_GATEWAY_API_KEY: "k",
      SEO_AGENT_MODEL: " anthropic/claude-x ",
      SEO_CLASSIFIER_MODEL: "reflection/other",
      SEO_AGENT_FALLBACK_MODEL: "anthropic/claude-y",
    })).toEqual({ executor: "anthropic/claude-x", classifier: "reflection/other", fallback: "anthropic/claude-y" });
  });
});

describe("classifierProviderOptions", () => {
  it("routes through the executor model with no speed by default", () => {
    const options = classifierProviderOptions({});
    expect(options).toEqual({ gateway: { models: ["anthropic/claude-sonnet-5.5"] } });
    expect(options.gateway).not.toHaveProperty("speed");
  });

  it("sends speed only when SEO_CLASSIFIER_SPEED is set", () => {
    expect(classifierProviderOptions({ SEO_CLASSIFIER_SPEED: "fast" })).toEqual({
      gateway: { models: ["anthropic/claude-sonnet-5.5"], speed: "fast" },
    });
    expect(classifierProviderOptions({ SEO_CLASSIFIER_SPEED: "  " }).gateway).not.toHaveProperty("speed");
  });
});

describe("costOfUsage", () => {
  it("prices Sonnet 5.5 input at $2 per million tokens", () => {
    expect(costOfUsage("anthropic/claude-sonnet-5.5", { inputTokens: 1_000_000, outputTokens: 0 })).toBe(2);
  });

  it("prices cached input at the cacheRead rate and output at the output rate", () => {
    expect(costOfUsage("anthropic/claude-sonnet-5.5", { inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 1_000_000 })).toBeCloseTo(0.2);
    expect(costOfUsage("anthropic/claude-sonnet-5.5", { inputTokens: 0, outputTokens: 1_000_000 })).toBe(10);
  });

  it("returns undefined for an unpriced model or unknown usage", () => {
    expect(costOfUsage("unknown/model", { inputTokens: 1, outputTokens: 1 })).toBeUndefined();
    expect(costOfUsage("anthropic/claude-sonnet-5.5", { outputTokens: 1 })).toBeUndefined();
  });

  it("merges SEO_MODEL_PRICES_JSON over the defaults and ignores invalid entries", () => {
    const env = { SEO_MODEL_PRICES_JSON: JSON.stringify({ "reflection/beam": { input: 1, output: 3 }, bad: { input: "x" } }) };
    expect(costOfUsage("reflection/beam", { inputTokens: 1_000_000, outputTokens: 0 }, env)).toBe(1);
    expect(costOfUsage("bad", { inputTokens: 1, outputTokens: 1 }, env)).toBeUndefined();
    expect(costOfUsage("reflection/beam", { inputTokens: 1, outputTokens: 1 }, { SEO_MODEL_PRICES_JSON: "not json" })).toBeUndefined();
  });
});

describe("classifyQuestion", () => {
  it("maps valid structured output through", async () => {
    const { deps } = fakeGenerate(async () => ({ output: validOutput, usage }));
    await expect(classifyQuestion("ws-1", "who links to example.com?", "profile", { deps })).resolves.toEqual(validOutput);
  });

  it("returns intent all when the model output does not parse", async () => {
    const { deps } = fakeGenerate(async () => { throw Object.assign(new Error("No object generated"), { name: "NoObjectGeneratedError" }); });
    await expect(classifyQuestion("ws-1", "q", "p", { deps })).resolves.toEqual(ALL);
  });

  it("returns intent all on a network error", async () => {
    const { deps } = fakeGenerate(async () => { throw new TypeError("fetch failed"); });
    await expect(classifyQuestion("ws-1", "q", "p", { deps })).resolves.toEqual(ALL);
  });

  it("returns intent all when the output violates the schema", async () => {
    const { deps } = fakeGenerate(async () => ({ output: { ...validOutput, intent: "shopping" }, usage }));
    await expect(classifyQuestion("ws-1", "q", "p", { deps })).resolves.toEqual(ALL);
    const tooManyKeywords = { ...validOutput, keywords: Array.from({ length: 11 }, (_, i) => `k${i}`) };
    const second = fakeGenerate(async () => ({ output: tooManyKeywords, usage }));
    await expect(classifyQuestion("ws-1", "q", "p", { deps: second.deps })).resolves.toEqual(ALL);
  });

  it("accepts every declared intent", async () => {
    for (const intent of [...INTENTS, "all"]) {
      const { deps } = fakeGenerate(async () => ({ output: { ...validOutput, intent }, usage }));
      await expect(classifyQuestion("ws-1", "q", "p", { deps })).resolves.toMatchObject({ intent });
    }
  });

  it("rethrows PaidCallDeniedError so the route can report paused", async () => {
    const denied = new PaidCallDeniedError("budget_exhausted", "Daily provider budget exhausted.");
    mocks.paid.mockRejectedValueOnce(denied);
    const { fn, deps } = fakeGenerate(async () => ({ output: validOutput, usage }));
    await expect(classifyQuestion("ws-1", "q", "p", { deps })).rejects.toBe(denied);
    expect(fn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("makes one model attempt with no SDK retries, so each attempt is one reservation", async () => {
    const { fn, deps } = fakeGenerate(async () => ({ output: validOutput, usage }));
    await classifyQuestion("ws-1", "q", "p", { deps });
    expect(fn.mock.calls[0]?.[0]).toMatchObject({ maxRetries: 0 });
  });

  it("rethrows the failure when the caller aborted, instead of answering intent all", async () => {
    const controller = new AbortController();
    const { deps } = fakeGenerate(async () => {
      controller.abort();
      throw new Error("aborted by client");
    });
    await expect(classifyQuestion("ws-1", "q", "p", { deps, signal: controller.signal })).rejects.toThrow("aborted by client");
  });

  it("charges through runPaidCall with workspace attribution", async () => {
    const { deps } = fakeGenerate(async () => ({ output: validOutput, usage }));
    await classifyQuestion("ws-1", "q", "p", { deps });
    expect(mocks.paid).toHaveBeenCalledWith(
      expect.objectContaining({ context: { workspaceId: "ws-1", sourceKey: "seo" }, provider: "gateway", action: "seo_classify", estimateUsd: 0.002 }),
      expect.any(Function),
    );
  });

  it("charges the estimate when the classifier model is unpriced", async () => {
    const { deps } = fakeGenerate(async () => ({ output: validOutput, usage }));
    await classifyQuestion("ws-1", "q", "p", { deps });
    expect(mocks.charged).toEqual([undefined]);
  });

  it("charges the computed cost when the classifier model is priced", async () => {
    vi.stubEnv("SEO_MODEL_PRICES_JSON", JSON.stringify({ "reflection/beam": { input: 1, output: 3 } }));
    const { deps } = fakeGenerate(async () => ({ output: validOutput, usage: { inputTokens: 1_000_000, outputTokens: 0 } }));
    await classifyQuestion("ws-1", "q", "p", { deps });
    expect(mocks.charged).toEqual([1]);
  });

  it("sends the executor model in gateway providerOptions with no speed by default", async () => {
    const { fn, deps } = fakeGenerate(async () => ({ output: validOutput, usage }));
    await classifyQuestion("ws-1", "q", "p", { deps });
    const options = fn.mock.calls[0]?.[0] as { providerOptions: { gateway: Record<string, unknown> } };
    expect(options.providerOptions.gateway.models).toEqual(["anthropic/claude-sonnet-5.5"]);
    expect(options.providerOptions.gateway).not.toHaveProperty("speed");
  });

  it("sends speed fast when SEO_CLASSIFIER_SPEED=fast", async () => {
    vi.stubEnv("SEO_CLASSIFIER_SPEED", "fast");
    const { fn, deps } = fakeGenerate(async () => ({ output: validOutput, usage }));
    await classifyQuestion("ws-1", "q", "p", { deps });
    const options = fn.mock.calls[0]?.[0] as { providerOptions: { gateway: Record<string, unknown> } };
    expect(options.providerOptions.gateway).toMatchObject({ models: ["anthropic/claude-sonnet-5.5"], speed: "fast" });
  });

  it("returns intent all without calling the model when the gateway key is blank", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    const { fn, deps } = fakeGenerate(async () => ({ output: validOutput, usage }));
    await expect(classifyQuestion("ws-1", "q", "p", { deps })).resolves.toEqual(ALL);
    expect(fn).not.toHaveBeenCalled();
    expect(mocks.paid).not.toHaveBeenCalled();
  });

  it("logs the error name only, never the question or the model output", async () => {
    const { deps } = fakeGenerate(async () => {
      throw Object.assign(new Error("upstream said: secret question text"), { name: "APICallError" });
    });
    await classifyQuestion("ws-1", "secret question text", "p", { deps });
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith("[seo-agent] classifier failed", { error: "APICallError" });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("secret question text");
  });
});
