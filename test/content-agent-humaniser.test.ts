import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createGateway: vi.fn(),
  generateText: vi.fn(),
  paidCall: vi.fn(),
  paidMeta: undefined as unknown,
  paidResult: undefined as unknown,
  gatewayOptions: undefined as unknown,
}));
vi.mock("ai", async (importOriginal) => ({
  ...await importOriginal<typeof import("ai")>(),
  createGateway: mocks.createGateway,
  generateText: mocks.generateText,
}));
vi.mock("@/lib/providers/paid-call", () => ({ runPaidCall: mocks.paidCall }));

import { contentDraftInputSchema } from "@/lib/content-agent/contracts";
import { humaniseContentDraft } from "@/lib/content-agent/humaniser";

const profile = {
  audience: "Founder-led teams",
  purpose: "Help readers make practical decisions.",
  voice: "Warm, direct and evidence-led.",
  structure: "Short opening and useful sections.",
  avoid: ["hype"],
  sampleText: "We build carefully and explain why.",
};

beforeEach(() => {
  mocks.paidMeta = undefined;
  mocks.paidResult = undefined;
  mocks.gatewayOptions = undefined;
  mocks.createGateway.mockReset().mockImplementation((options: unknown) => {
    mocks.gatewayOptions = options;
    return (model: string) => ({ model });
  });
  mocks.generateText.mockReset().mockResolvedValue({
    text: "A clearer, more natural Australian English draft.",
    finishReason: "stop",
    usage: { inputTokens: 100, outputTokens: 20, inputTokenDetails: { cacheReadTokens: 0 } },
  });
  mocks.paidCall.mockReset().mockImplementation(async (meta: unknown, work: () => Promise<unknown>) => {
    mocks.paidMeta = meta;
    const result = await work() as { value?: unknown; error?: Error; costUsd?: number };
    mocks.paidResult = result;
    if (result.error) throw result.error;
    return result.value;
  });
});

describe("Content brand-voice humaniser", () => {
  it("records actual usage when the model returns an empty draft", async () => {
    mocks.generateText.mockResolvedValueOnce({
      text: "  ",
      finishReason: "stop",
      usage: { inputTokens: 100, outputTokens: 500, inputTokenDetails: { cacheReadTokens: 0 } },
    });

    await expect(humaniseContentDraft({
      workspaceId: "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a11",
      draft: { title: "A useful post", body: "Original wording.", format: "blog_post" },
      profile,
      models: { apiKey: "test-key", model: "anthropic/claude-sonnet-5.5" },
    })).rejects.toThrow("The Content humaniser returned an empty draft.");
    expect(mocks.paidResult).toEqual({
      error: expect.objectContaining({ message: "The Content humaniser returned an empty draft." }),
      costUsd: 0.0052,
    });
  });

  it("does not return a draft truncated by the output token limit", async () => {
    mocks.generateText.mockResolvedValueOnce({
      text: "An incomplete draft",
      finishReason: "length",
      usage: { inputTokens: 100, outputTokens: 5000, inputTokenDetails: { cacheReadTokens: 0 } },
    });

    await expect(humaniseContentDraft({
      workspaceId: "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a11",
      draft: { title: "A useful post", body: "Original wording.", format: "blog_post" },
      profile,
      models: { apiKey: "test-key", model: "anthropic/claude-sonnet-5.5" },
    })).rejects.toThrow("The Content humaniser output was truncated.");
    expect(mocks.paidResult).toEqual({
      error: expect.objectContaining({ message: "The Content humaniser output was truncated." }),
      costUsd: 0.0502,
    });
  });

  it("allows enough output for the longest draft the schema accepts", async () => {
    const body = "Dense, link-heavy Markdown: https://example.com/a?b=c. ".repeat(500).slice(0, 24_000);
    const draft = contentDraftInputSchema.parse({ title: "T".repeat(120), body, format: "blog_post" });

    await humaniseContentDraft({
      workspaceId: "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a11",
      draft,
      profile,
      models: { apiKey: "test-key", model: "anthropic/claude-sonnet-5.5" },
    });

    // Returned unchanged, a 24,120-character draft needs about 12,000 tokens at a dense 2 characters per token.
    const { maxOutputTokens } = mocks.generateText.mock.calls[0][0] as { maxOutputTokens: number };
    expect(maxOutputTokens).toBeGreaterThanOrEqual(Math.ceil((draft.title.length + draft.body.length) / 2));
  });

  it("rewrites every supplied draft under its saved voice and a separate Gateway reservation", async () => {
    const signal = new AbortController().signal;
    await expect(humaniseContentDraft({
      workspaceId: "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a11",
      draft: { title: "A useful post", body: "Original wording.", format: "blog_post" },
      profile,
      models: { apiKey: "test-key", model: "anthropic/claude-sonnet-5.5" },
      signal,
    })).resolves.toBe("A clearer, more natural Australian English draft.");

    expect(mocks.paidMeta).toEqual(expect.objectContaining({
      context: { workspaceId: "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a11", sourceKey: "content" },
      provider: "gateway",
      action: "content_humaniser",
      signal,
    }));
    expect(mocks.gatewayOptions).toEqual({ apiKey: "test-key" });
    expect(mocks.generateText).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining("Original wording."),
      system: expect.stringContaining("Australian English"),
      maxRetries: 0,
      abortSignal: signal,
    }));
    expect(mocks.paidResult).toEqual({
      value: "A clearer, more natural Australian English draft.",
      costUsd: 0.0004,
    });
  });
});
