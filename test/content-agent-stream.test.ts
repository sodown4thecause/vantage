import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  paidCall: vi.fn(),
  createStream: vi.fn(),
  upsert: vi.fn(),
  meta: undefined as unknown,
  workResult: undefined as unknown,
  streamOptions: undefined as unknown,
}));
vi.mock("@/lib/providers/paid-call", () => ({
  runPaidCall: mocks.paidCall,
}));
vi.mock("@/lib/content-agent/repository", () => ({
  upsertContentAssistantMessage: mocks.upsert,
}));
vi.mock("ai", async (importOriginal) => ({
  ...await importOriginal<typeof import("ai")>(),
  createAgentUIStreamResponse: mocks.createStream,
}));

import { createContentAgentResponse } from "@/lib/content-agent/stream";

const workspaceId = "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a11";
const threadId = "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a12";
const responseMessage = { id: "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a13", role: "assistant", parts: [{ type: "text", text: "A useful draft." }] };

beforeEach(() => {
  mocks.meta = undefined;
  mocks.workResult = undefined;
  mocks.streamOptions = undefined;
  mocks.upsert.mockReset().mockResolvedValue(undefined);
  mocks.createStream.mockReset().mockImplementation(async (options: unknown) => {
    mocks.streamOptions = options;
    return new Response("stream");
  });
  mocks.paidCall.mockReset().mockImplementation(async (meta: unknown, work: () => Promise<unknown>) => {
    mocks.meta = meta;
    const result = await work() as { value?: unknown; costUsd?: number; error?: Error };
    mocks.workResult = result;
    if (result.error) throw result.error;
    return result.value;
  });
});

describe("Content agent stream metering and persistence", () => {
  it("holds one Gateway reservation through the streamed turn and records token cost", async () => {
    const controller = new AbortController();
    const models = { apiKey: "test-key", model: "anthropic/claude-sonnet-5.5" };
    const agent = { id: "content-agent", tools: {}, stream: vi.fn() } as never;
    const response = await createContentAgentResponse({
      workspaceId,
      threadId,
      agent,
      messages: [],
      abortSignal: controller.signal,
      models,
    });

    expect(response.status).toBe(200);
    expect(mocks.meta).toEqual(expect.objectContaining({
      context: { workspaceId, sourceKey: "content" },
      provider: "gateway",
      action: "content_agent",
      estimateUsd: 0.15,
      signal: controller.signal,
    }));

    const options = mocks.streamOptions as {
      onStepEnd: (event: unknown) => void;
      onUIMessageStepEnd: (event: { responseMessage: typeof responseMessage }) => Promise<void>;
      onEnd: (event: { responseMessage: typeof responseMessage; outcome: { status: "completed" } }) => Promise<void>;
    };
    options.onStepEnd({ usage: { inputTokens: 100, outputTokens: 10, inputTokenDetails: { cacheReadTokens: 20 } } });
    await options.onUIMessageStepEnd({ responseMessage });
    await options.onEnd({ responseMessage, outcome: { status: "completed" } });

    expect(mocks.upsert).toHaveBeenLastCalledWith(expect.objectContaining({
      id: expect.any(String), workspaceId, threadId, content: "A useful draft.", status: "complete",
    }));
    await vi.waitFor(() => expect(mocks.workResult).toEqual({ value: undefined, costUsd: 0.000264 }));
  });
});
