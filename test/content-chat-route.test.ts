import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  models: vi.fn(),
  createThread: vi.fn(),
  getThread: vi.fn(),
  getBrandProfile: vi.fn(),
  appendMessage: vi.fn(),
  createAgent: vi.fn(),
  createResponse: vi.fn(),
}));
vi.mock("@/lib/auth/workspace", () => ({ authorizeWorkspace: mocks.authorize }));
vi.mock("@/lib/content-agent/models", () => ({ contentAgentModels: mocks.models }));
vi.mock("@/lib/content-agent/repository", () => ({
  createContentThread: mocks.createThread,
  getContentThreadContext: mocks.getThread,
  getContentBrandVoiceProfile: mocks.getBrandProfile,
  appendContentMessage: mocks.appendMessage,
}));
vi.mock("@/lib/content-agent/agent", () => ({ createContentAgent: mocks.createAgent }));
vi.mock("@/lib/content-agent/stream", () => ({ createContentAgentResponse: mocks.createResponse }));

import { POST } from "@/app/api/content/chat/route";

const workspaceId = "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a11";
const threadId = "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a12";
const request = (body: unknown) => new Request("http://localhost/api/content/chat", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

beforeEach(() => {
  mocks.authorize.mockReset().mockResolvedValue({ ok: true });
  mocks.models.mockReset().mockReturnValue({ model: "anthropic/claude-sonnet-5.5" });
  mocks.createThread.mockReset().mockResolvedValue({ id: threadId, workspaceId, title: "Write a post" });
  mocks.getThread.mockReset().mockResolvedValue({ thread: { id: threadId }, messages: [] });
  mocks.getBrandProfile.mockReset().mockResolvedValue(null);
  mocks.appendMessage.mockReset().mockImplementation(async (args) => ({
    id: "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a13",
    ...args,
    status: args.status ?? "complete",
  }));
  mocks.createAgent.mockReset().mockReturnValue({ id: "content-agent" });
  mocks.createResponse.mockReset().mockResolvedValue(new Response("stream", { status: 200 }));
});

describe("POST /api/content/chat", () => {
  it("refuses unauthorised workspaces before reading or creating content", async () => {
    mocks.authorize.mockResolvedValue({ ok: false, status: 401, error: "unauthorized" });
    const response = await POST(request({ workspaceId, message: "Write a post" }));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
    expect(mocks.createThread).not.toHaveBeenCalled();
    expect(mocks.getThread).not.toHaveBeenCalled();
    expect(mocks.createAgent).not.toHaveBeenCalled();
  });

  it("does not reveal a thread owned by another workspace", async () => {
    mocks.getThread.mockResolvedValue(null);
    const response = await POST(request({ workspaceId, threadId, message: "Continue this draft" }));
    expect(response.status).toBe(404);
    expect(mocks.createAgent).not.toHaveBeenCalled();
    expect(mocks.appendMessage).not.toHaveBeenCalled();
  });

  it("stores a workspace-scoped user turn and streams it through the Content agent", async () => {
    const brandVoiceProfile = {
      workspaceId,
      audience: "Founder-led teams",
      purpose: "Help readers make practical decisions.",
      voice: "Warm and direct.",
      structure: "Short sections.",
      avoid: ["hype"],
      sampleText: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    };
    mocks.getBrandProfile.mockResolvedValue(brandVoiceProfile);
    const response = await POST(request({ workspaceId, message: "  Write a useful post  " }));
    expect(response.status).toBe(200);
    expect(mocks.createThread).toHaveBeenCalledWith(workspaceId, "Write a useful post");
    expect(mocks.appendMessage).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId,
      threadId,
      role: "user",
      content: "Write a useful post",
    }));
    expect(mocks.getBrandProfile).toHaveBeenCalledWith(workspaceId);
    expect(mocks.createAgent).toHaveBeenCalledWith({ workspaceId, threadId, models: { model: "anthropic/claude-sonnet-5.5" }, brandVoiceProfile });
    expect(mocks.createResponse).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId,
      threadId,
      abortSignal: expect.any(AbortSignal),
    }));
  });

  it("reuses the saved user turn when retrying and excludes the failed assistant response", async () => {
    mocks.getThread.mockResolvedValue({
      thread: { id: threadId },
      messages: [
        { id: "user-turn", role: "user", content: "Write a useful post", status: "complete" },
        { id: "failed-turn", role: "assistant", content: "Partial response", status: "failed" },
      ],
    });

    const response = await POST(request({ workspaceId, threadId, message: "Write a useful post", retry: true }));

    expect(response.status).toBe(200);
    expect(mocks.appendMessage).not.toHaveBeenCalled();
    expect(mocks.createResponse).toHaveBeenCalledWith(expect.objectContaining({
      messages: [expect.objectContaining({ id: "user-turn", role: "user", parts: [{ type: "text", text: "Write a useful post" }] })],
    }));
  });

  it("rejects retry requests without a thread id", async () => {
    const response = await POST(request({ workspaceId, message: "Write a useful post", retry: true }));
    expect(response.status).toBe(400);
  });

  it("returns the created thread id if streaming fails so a retry can resume it", async () => {
    mocks.createResponse.mockRejectedValueOnce(new Error("stream unavailable"));
    const response = await POST(request({ workspaceId, message: "Write a useful post" }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "agent_unavailable", threadId });
  });
});
