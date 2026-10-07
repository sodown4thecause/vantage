import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { paidCall, network, bills } = vi.hoisted(() => ({
  paidCall: vi.fn(), network: vi.fn(), bills: [] as Array<{ costUsd?: number }>,
}));
vi.mock("@/lib/providers/paid-call", () => ({ runPaidCall: paidCall }));

import { analyzeXPostSignificance } from "@/lib/x/gateway";
import type { XPost } from "@/lib/x/client";

const post: XPost = { id: "1234567890123456789", text: "Literal retrieved developer-tool question",
  url: "https://x.com/builder/status/1234567890123456789", author: "builder",
  createdAt: "2026-10-06T12:00:00.000Z", likeCount: 2, repostCount: 0, replyCount: 1 };
const context = { workspaceId: "ws-1", sourceKey: "x" };
function response(rows: unknown[], usage: unknown = { input_tokens: 1000, output_tokens: 500 }) {
  return new Response(JSON.stringify({ status: "completed", usage,
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text",
      text: JSON.stringify({ posts: rows }), annotations: [] }] }] }));
}

beforeEach(() => {
  vi.resetAllMocks(); bills.length = 0;
  vi.stubEnv("AI_GATEWAY_API_KEY", "test-key"); vi.stubEnv("X_GATEWAY_MODEL", "");
  vi.stubGlobal("fetch", network);
  paidCall.mockImplementation(async (_options, work) => {
    const result = await work(); bills.push(result); return result.value;
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("experimental Grok significance on retrieved X posts", () => {
  it("uses documented Gateway Responses without pretending the model acquired posts", async () => {
    network.mockResolvedValue(response([{ url: post.url, score: 0.8, reason: "Specific developer-tool need" }]));
    const result = await analyzeXPostSignificance([post], { ctx: context });
    expect(result).toEqual({ model: "spacexai/grok-4.7", posts: [{ ...post,
      significance: { score: 0.8, reason: "Specific developer-tool need" } }] });
    const [url, request] = network.mock.calls[0];
    expect(url).toBe("https://ai-gateway.vercel.sh/v1/responses");
    const payload = JSON.parse(request.body);
    expect(payload).toMatchObject({ model: "spacexai/grok-4.7", max_output_tokens: 2048, store: false });
    expect(payload.tools).toBeUndefined();
    expect(payload.input).toContain(post.text);
    expect(paidCall).toHaveBeenCalledWith(expect.objectContaining({
      provider: "ai_gateway", action: "x_significance", context,
      estimateUsd: expect.any(Number),
    }), expect.any(Function));
    expect(bills[0]?.costUsd).toBeCloseTo(0.005);
  });

  it("allows model abstention without changing literal acquired posts", async () => {
    network.mockResolvedValue(response([]));
    expect((await analyzeXPostSignificance([post], { ctx: context })).posts).toEqual([post]);
  });

  it.each([
    { posts: [{ url: "https://x.com/invented/status/777", score: 0.8, reason: "invented source" }] },
    { posts: [{ url: post.url, score: 5, reason: "invalid score" }] },
    { posts: [{ url: post.url, score: 0.8, reason: "valid" }, { url: post.url, score: 0.7, reason: "duplicate" }] },
  ])("rejects unmatched sources and malformed significance output", async ({ posts }) => {
    network.mockResolvedValue(response(posts));
    await expect(analyzeXPostSignificance([post], { ctx: context })).rejects.toThrow(/invalid/i);
    expect(bills[0]?.costUsd).toBeCloseTo(0.005);
  });

  it("records known token usage before rejecting malformed model JSON", async () => {
    network.mockResolvedValue(new Response(JSON.stringify({ status: "completed",
      usage: { input_tokens: 1000, output_tokens: 500 },
      output: [{ type: "message", content: [{ type: "output_text", text: "Invalid model JSON" }] }] })));
    await expect(analyzeXPostSignificance([post], { ctx: context })).rejects.toThrow(/invalid/i);
    expect(bills[0]?.costUsd).toBeCloseTo(0.005);
  });

  it("stops reading and cancels a response over the 96 KB bound", async () => {
    let pulls = 0;
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls <= 3) controller.enqueue(new Uint8Array(50_000).fill(32));
        else controller.close();
      }, cancel,
    }, { highWaterMark: 0 });
    network.mockResolvedValue(new Response(stream));
    await expect(analyzeXPostSignificance([post], { ctx: context })).rejects.toThrow(/size limit/i);
    expect(pulls).toBe(2);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("uses the conservative reservation when usage is missing", async () => {
    network.mockResolvedValue(response([], {}));
    await analyzeXPostSignificance([post], { ctx: context });
    expect(bills[0]?.costUsd).toBeUndefined();
  });

  it.each(["spacexai/grok-4.6", "xai/grok-4.7", "__proto__", "toString"])("rejects unverified model %s before billing or sending data", async model => {
    vi.stubEnv("X_GATEWAY_MODEL", model);
    network.mockResolvedValue(response([]));
    await expect(analyzeXPostSignificance([post], { ctx: context })).rejects.toThrow(/model/i);
    expect(network).not.toHaveBeenCalled(); expect(paidCall).not.toHaveBeenCalled();
  });

  it("requires Gateway credentials before billing", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    await expect(analyzeXPostSignificance([post], { ctx: context })).rejects.toThrow(/access pending/i);
    expect(paidCall).not.toHaveBeenCalled();
  });

  it("never calls the model for an empty acquired set", async () => {
    expect((await analyzeXPostSignificance([], { ctx: context })).posts).toEqual([]);
    expect(network).not.toHaveBeenCalled(); expect(paidCall).not.toHaveBeenCalled();
  });

  it("sanitizes non-success HTTP bodies", async () => {
    network.mockResolvedValue(new Response("sk-live-secret", { status: 401 }));
    await expect(analyzeXPostSignificance([post], { ctx: context })).rejects.toThrow("Gateway provider unavailable (HTTP 401)");
  });

  it("honors cancellation before reserving funds", async () => {
    const abort = new AbortController(); abort.abort();
    await expect(analyzeXPostSignificance([post], { ctx: context, signal: abort.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(paidCall).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
  });
});
