import type { UIMessageChunk } from "ai";
import { describe, expect, it, vi } from "vitest";

import { summarizeEvidence } from "@/lib/seo-agent/summarize";
import { EndpointAttemptBudget, QuestionBudget } from "@/lib/seo-agent/budget";

describe("summarizeEvidence", () => {
  it("forwards answer text before the model has finished", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "gateway-test-key");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const streamText = vi.fn(() => ({
      finishReason: gate.then(() => "stop"),
      toUIMessageStream: () => new ReadableStream<UIMessageChunk>({
        async start(controller) {
          controller.enqueue({ type: "text-start", id: "t" } as UIMessageChunk);
          controller.enqueue({ type: "text-delta", id: "t", delta: "Hello" } as UIMessageChunk);
          await gate;
          controller.enqueue({ type: "text-end", id: "t" } as UIMessageChunk);
          controller.close();
        },
      }),
    }));
    const write = vi.fn();
    const done = summarizeEvidence({
      workspaceId: "ws",
      question: "q",
      packet: { question: "q", conversationContext: "", profile: null, entries: [], notices: [], pendingApprovals: [] },
      profile: { productDomain: null, productName: null, competitor: null, topic: null, description: "", targetCustomer: "" } as never,
      intent: "keywords",
      modelId: "model-x",
      fallbackModelId: null,
      ctx: { workspaceId: "ws", budget: new QuestionBudget(0, []), attempts: new EndpointAttemptBudget(), brandDomains: [], cards: [], notices: [] },
      writer: { write } as never,
      deps: { streamText: streamText as never },
    });
    try {
      await vi.waitFor(() => expect(write).toHaveBeenCalledWith(expect.objectContaining({ type: "text-delta", delta: "Hello" })), { timeout: 500 });
    } finally {
      release();
    }
    expect((await done).kind).toBe("complete");
  });

  describe("stream reader cleanup", () => {
    const run = (reader: unknown, write: (chunk: unknown) => void) => {
      vi.stubEnv("AI_GATEWAY_API_KEY", "gateway-test-key");
      const streamText = vi.fn(() => ({
        finishReason: Promise.resolve("stop"),
        toUIMessageStream: () => ({ getReader: () => reader }),
      }));
      return summarizeEvidence({
        workspaceId: "ws",
        question: "q",
        packet: { question: "q", conversationContext: "", profile: null, entries: [], notices: [], pendingApprovals: [] },
        profile: { productDomain: null, productName: null, competitor: null, topic: null, description: "", targetCustomer: "" } as never,
        intent: "keywords",
        modelId: "model-x",
        fallbackModelId: null,
        ctx: { workspaceId: "ws", budget: new QuestionBudget(0, []), attempts: new EndpointAttemptBudget(), brandDomains: [], cards: [], notices: [] },
        writer: { write } as never,
        deps: { streamText: streamText as never },
      });
    };
    const textChunk = { type: "text-delta", id: "t", delta: "Hello" } as UIMessageChunk;

    it("cancels and releases the reader when the writer throws", async () => {
      const reader = {
        read: vi.fn().mockResolvedValueOnce({ done: false, value: textChunk }).mockResolvedValue({ done: true }),
        cancel: vi.fn().mockResolvedValue(undefined),
        releaseLock: vi.fn(),
      };
      const result = await run(reader, () => { throw new Error("writer closed"); });
      expect(result.kind).toBe("error");
      expect(reader.cancel).toHaveBeenCalledTimes(1);
      expect(reader.releaseLock).toHaveBeenCalledTimes(1);
    });

    it("cancels and releases the reader when read() rejects", async () => {
      const reader = {
        read: vi.fn().mockRejectedValue(new Error("network reset")),
        cancel: vi.fn().mockResolvedValue(undefined),
        releaseLock: vi.fn(),
      };
      const result = await run(reader, vi.fn());
      expect(result.kind).toBe("error");
      expect(reader.cancel).toHaveBeenCalledTimes(1);
      expect(reader.releaseLock).toHaveBeenCalledTimes(1);
    });

    it("releases the reader without cancelling after a complete read", async () => {
      const reader = {
        read: vi.fn().mockResolvedValueOnce({ done: false, value: textChunk }).mockResolvedValue({ done: true }),
        cancel: vi.fn().mockResolvedValue(undefined),
        releaseLock: vi.fn(),
      };
      const result = await run(reader, vi.fn());
      expect(result.kind).toBe("complete");
      expect(reader.cancel).not.toHaveBeenCalled();
      expect(reader.releaseLock).toHaveBeenCalledTimes(1);
    });
  });
});
