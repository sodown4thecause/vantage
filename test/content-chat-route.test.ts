import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  models: vi.fn(),
  createThread: vi.fn(),
  getThread: vi.fn(),
  getBrandProfile: vi.fn(),
  getDraft: vi.fn(),
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
  getContentDraft: mocks.getDraft,
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
  mocks.getDraft.mockReset().mockResolvedValue(null);
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

  it("preserves exact text and passes structured draft edits separately from the prompt", async () => {
    const message = "Save these edits.\n\nExact body:\n  Edited copy.  ";
    const draftUpdate = { draftId: "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a13", title: "Exact title", body: "  Edited copy.  " };
    const response = await POST(request({ workspaceId, message, preserveText: true, draftUpdate }));

    expect(response.status).toBe(200);
    expect(mocks.createThread).toHaveBeenCalledWith(workspaceId, message);
    expect(mocks.appendMessage).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, threadId, role: "user", content: message }));
    expect(mocks.createAgent).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, threadId, draftUpdate }));
  });

  it("rejects structured draft edits when the request does not preserve exact text", async () => {
    const response = await POST(request({
      workspaceId,
      message: "Save these edits.",
      draftUpdate: { draftId: "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a13", title: "Exact title", body: "Exact body." },
    }));

    expect(response.status).toBe(400);
    expect(mocks.createAgent).not.toHaveBeenCalled();
    expect(mocks.appendMessage).not.toHaveBeenCalled();
  });

  it("loads the repurpose source from the authorized workspace before creating the agent", async () => {
    const draftId = "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a14";
    const savedDraft = { id: draftId, workspaceId, threadId, title: "Original", body: ["Original copy.", "", "Sources:", "- https://community.example/source"].join(String.fromCharCode(10)), sourceCitations: [{ title: "Source", url: "https://community.example/source" }], format: "blog_post" };
    mocks.getDraft.mockResolvedValue(savedDraft);

    const response = await POST(request({
      workspaceId,
      message: "Repurpose this as a LinkedIn post.",
      repurposeDraft: { draftId, format: "linkedin_post" },
    }));

    expect(response.status).toBe(200);
    expect(mocks.getDraft).toHaveBeenCalledWith(workspaceId, draftId);
    expect(mocks.createAgent).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, repurposeDraft: savedDraft }));
  });

  it("rejects repurposing into the source draft's current format", async () => {
    const draftId = "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a14";
    mocks.getDraft.mockResolvedValue({ id: draftId, format: "blog_post" });

    const response = await POST(request({
      workspaceId,
      message: "Repurpose this as another blog post.",
      repurposeDraft: { draftId, format: "blog_post" },
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_repurpose_format" });
    expect(mocks.createThread).not.toHaveBeenCalled();
    expect(mocks.createAgent).not.toHaveBeenCalled();
  });

  it("reloads the repurpose source and its citation manifest on retry", async () => {
    const draftId = "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a14";
    const message = "Repurpose this as a LinkedIn post.";
    const savedDraft = { id: draftId, format: "blog_post", sourceCitations: [{ title: "Source", url: "https://community.example/source" }] };
    mocks.getDraft.mockResolvedValue(savedDraft);
    mocks.getThread.mockResolvedValue({ thread: { id: threadId }, messages: [{ id: "user-turn", role: "user", content: message, status: "complete" }] });

    const response = await POST(request({ workspaceId, threadId, message, retry: true, repurposeDraft: { draftId, format: "linkedin_post" } }));

    expect(response.status).toBe(200);
    expect(mocks.getDraft).toHaveBeenCalledWith(workspaceId, draftId);
    expect(mocks.appendMessage).not.toHaveBeenCalled();
    expect(mocks.createAgent).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, repurposeDraft: savedDraft }));
  });

  it("does not expose or use a repurpose source outside the authorized workspace", async () => {
    const response = await POST(request({
      workspaceId,
      message: "Repurpose this as a LinkedIn post.",
      repurposeDraft: { draftId: "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a14", format: "linkedin_post" },
    }));

    expect(response.status).toBe(404);
    expect(mocks.createThread).not.toHaveBeenCalled();
    expect(mocks.appendMessage).not.toHaveBeenCalled();
    expect(mocks.createAgent).not.toHaveBeenCalled();
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

  it("returns not found when retrying a thread that does not exist", async () => {
    mocks.getThread.mockResolvedValue(null);
    const response = await POST(request({ workspaceId, threadId, message: "Write a useful post", retry: true }));
    expect(response.status).toBe(404);
    expect(mocks.createThread).not.toHaveBeenCalled();
    expect(mocks.appendMessage).not.toHaveBeenCalled();
    expect(mocks.createResponse).not.toHaveBeenCalled();
  });

  it("rejects retry requests without a thread id", async () => {
    const response = await POST(request({ workspaceId, message: "Write a useful post", retry: true }));
    expect(response.status).toBe(400);
  });

  it("returns a generic service error when the brand voice profile lookup fails", async () => {
    mocks.getBrandProfile.mockRejectedValueOnce(new Error("database unavailable"));
    const response = await POST(request({ workspaceId, message: "Write a useful post" }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "agent_unavailable" });
    expect(mocks.createThread).not.toHaveBeenCalled();
  });

  it("returns the created thread id if streaming fails so a retry can resume it", async () => {
    mocks.createResponse.mockRejectedValueOnce(new Error("stream unavailable"));
    const response = await POST(request({ workspaceId, message: "Write a useful post" }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "agent_unavailable", threadId });
  });
});
