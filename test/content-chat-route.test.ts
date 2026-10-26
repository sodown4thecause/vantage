import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  models: vi.fn(),
  createThread: vi.fn(),
  getThread: vi.fn(),
  appendMessage: vi.fn(),
  createAgent: vi.fn(),
  createResponse: vi.fn(),
}));
vi.mock("@/lib/auth/workspace", () => ({ authorizeWorkspace: mocks.authorize }));
vi.mock("@/lib/content-agent/models", () => ({ contentAgentModels: mocks.models }));
vi.mock("@/lib/content-agent/repository", () => ({
  createContentThread: mocks.createThread,
  getContentThread: mocks.getThread,
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
  mocks.appendMessage.mockReset().mockResolvedValue({ id: "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a13" });
  mocks.createAgent.mockReset().mockReturnValue({ id: "content-agent" });
  mocks.createResponse.mockReset().mockResolvedValue(new Response("stream", { status: 200 }));
});

describe("POST /api/content/chat", () => {
  it("refuses unauthorised workspaces before reading or creating content", async () => {
    mocks.authorize.mockResolvedValue({ ok: false });
    const response = await POST(request({ workspaceId, message: "Write a post" }));
    expect(response.status).toBe(403);
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
    const response = await POST(request({ workspaceId, message: "  Write a useful post  " }));
    expect(response.status).toBe(200);
    expect(mocks.createThread).toHaveBeenCalledWith(workspaceId, "Write a useful post");
    expect(mocks.appendMessage).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId,
      threadId,
      role: "user",
      content: "Write a useful post",
    }));
    expect(mocks.createAgent).toHaveBeenCalledWith({ workspaceId, threadId, models: { model: "anthropic/claude-sonnet-5.5" } });
    expect(mocks.createResponse).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId,
      threadId,
      abortSignal: expect.any(AbortSignal),
    }));
  });

  it("returns the created thread id if streaming fails so a retry can resume it", async () => {
    mocks.createResponse.mockRejectedValueOnce(new Error("stream unavailable"));
    const response = await POST(request({ workspaceId, message: "Write a useful post" }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "agent_unavailable", threadId });
  });
});
