import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ai: null as null | { run: ReturnType<typeof vi.fn> },
  paid: vi.fn(),
  paidMeta: undefined as unknown,
}));

vi.mock("@/lib/cf/env", () => ({
  getAi: async () => mocks.ai,
  getCloudflareRequestContext: async () => null,
}));
vi.mock("@/lib/providers/paid-call", () => ({
  runPaidCall: async (meta: unknown, work: () => Promise<unknown>) => {
    mocks.paidMeta = meta;
    return mocks.paid(meta, work);
  },
}));

import { askClef, estimateClefTokens, estimateClefUsd } from "@/lib/decisions/clef";

const WORKSPACE = "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a11";
const QUESTIONS = { urgent: { type: "noul" as const, instructions: "Is this urgent?" } };

const answer = (payload: unknown) => ({
  model: "clef-1.0.0",
  answers: payload,
  usage: { input_tokens: 500, output_tokens: 0 },
});

beforeEach(() => {
  mocks.paidMeta = undefined;
  mocks.ai = { run: vi.fn().mockResolvedValue(answer({ urgent: { type: "noul", noul: 0.9 } })) };
  // The real runPaidCall reserves budget and settles; here it just runs the work.
  mocks.paid.mockReset().mockImplementation(async (_meta: unknown, work: () => Promise<unknown>) => {
    const result = await work() as { value: unknown };
    return result.value;
  });
});

describe("Clef wrapper", () => {
  it("asks the model through the gateway and returns typed answers", async () => {
    const result = await askClef({
      workspaceId: WORKSPACE,
      sourceKey: "reddit",
      action: "clef_prefilter",
      variant: "clef-flash",
      state: "A thread about local evaluation harnesses.",
      questions: QUESTIONS,
    });
    expect(result).toEqual({
      model: "clef-1.0.0",
      answers: { urgent: { type: "noul", noul: 0.9 } },
      inputTokens: 500,
    });
    expect(mocks.ai!.run).toHaveBeenCalledWith(
      "@cf/cloudflare/clef-flash",
      expect.objectContaining({ model: "clef-flash", questions: QUESTIONS }),
      { gateway: { id: "vantage" } },
    );
    expect(mocks.paidMeta).toMatchObject({
      context: { workspaceId: WORKSPACE, sourceKey: "reddit" },
      provider: "workers_ai",
      action: "clef_prefilter",
    });
  });

  it("uses the precision model for ranking", async () => {
    await askClef({
      workspaceId: WORKSPACE,
      sourceKey: "opportunity",
      action: "clef_rank",
      variant: "clef",
      state: "state",
      questions: QUESTIONS,
    });
    expect(mocks.ai!.run.mock.calls[0][0]).toBe("@cf/cloudflare/clef");
  });

  it("fills the optional choice and score fields", async () => {
    mocks.ai!.run.mockResolvedValue(answer({
      fit: { type: "choice", choice: "segment_1", probabilities: { segment_1: 0.7, not_fit: 0.3 } },
      expertise: { type: "score", score: 2.4 },
    }));
    const result = await askClef({
      workspaceId: WORKSPACE,
      sourceKey: "opportunity",
      action: "clef_rank",
      variant: "clef",
      state: "state",
      questions: QUESTIONS,
    });
    expect(result?.answers.fit).toEqual({
      type: "choice",
      choice: "segment_1",
      confidence: 0.7,
      probabilities: { segment_1: 0.7, not_fit: 0.3 },
    });
    expect(result?.answers.expertise).toEqual({
      type: "score",
      score: 2.4,
      confidence: 0,
      legend: {},
      probabilities: {},
    });
  });

  it("returns null when the AI binding is absent", async () => {
    mocks.ai = null;
    expect(await askClef({
      workspaceId: WORKSPACE, sourceKey: "reddit", action: "clef_prefilter",
      variant: "clef-flash", state: "state", questions: QUESTIONS,
    })).toBeNull();
    expect(mocks.paid).not.toHaveBeenCalled();
  });

  it("uses an injected binding so a CLI harness can call Clef", async () => {
    mocks.ai = null;
    const injected = { run: vi.fn().mockResolvedValue(answer({ urgent: { type: "noul", noul: 0.4 } })) };
    const result = await askClef({
      workspaceId: WORKSPACE, sourceKey: "eval", action: "clef_eval",
      variant: "clef", state: "state", questions: QUESTIONS, ai: injected,
    });
    expect(result?.answers.urgent).toEqual({ type: "noul", noul: 0.4 });
    expect(injected.run).toHaveBeenCalledOnce();
  });

  it("returns null on a malformed answer so the current scorer stands", async () => {
    mocks.ai!.run.mockResolvedValue({ answers: { urgent: { type: "noul", noul: 4 } } });
    expect(await askClef({
      workspaceId: WORKSPACE, sourceKey: "reddit", action: "clef_prefilter",
      variant: "clef-flash", state: "state", questions: QUESTIONS,
    })).toBeNull();
  });

  it("returns null when the model call fails", async () => {
    mocks.ai!.run.mockRejectedValue(new Error("upstream unavailable"));
    expect(await askClef({
      workspaceId: WORKSPACE, sourceKey: "reddit", action: "clef_prefilter",
      variant: "clef-flash", state: "state", questions: QUESTIONS,
    })).toBeNull();
  });

  it("returns null when the call exceeds its timeout", async () => {
    mocks.ai!.run.mockImplementation(() => new Promise(() => {}));
    expect(await askClef({
      workspaceId: WORKSPACE, sourceKey: "reddit", action: "clef_prefilter",
      variant: "clef-flash", state: "state", questions: QUESTIONS, timeoutMs: 10,
    })).toBeNull();
  });

  it("propagates cancellation instead of swallowing it", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(askClef({
      workspaceId: WORKSPACE, sourceKey: "reddit", action: "clef_prefilter",
      variant: "clef-flash", state: "state", questions: QUESTIONS, signal: controller.signal,
    })).rejects.toThrow();
  });
});

describe("Clef cost estimate", () => {
  it("floors the token estimate at one so the reservation is positive", () => {
    expect(estimateClefTokens("")).toBe(1);
    expect(estimateClefTokens("a".repeat(400))).toBe(100);
    expect(estimateClefUsd("a".repeat(2_000))).toBeCloseTo(0.00012, 8);
  });
});
