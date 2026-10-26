import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  agentOptions: undefined as unknown,
  createDraft: vi.fn(),
  createModel: vi.fn(),
  saveProfile: vi.fn(),
}));

vi.mock("ai", () => ({
  ToolLoopAgent: class { constructor(options: unknown) { mocks.agentOptions = options; } },
  stepCountIs: () => undefined,
  tool: (definition: unknown) => definition,
}));
vi.mock("@/lib/content-agent/drafts", () => ({ createHumanisedContentDraft: mocks.createDraft }));
vi.mock("@/lib/content-agent/models", () => ({ createContentGatewayModel: mocks.createModel }));
vi.mock("@/lib/content-agent/repository", () => ({ saveContentBrandVoiceProfile: mocks.saveProfile }));

import { createContentAgent } from "@/lib/content-agent/agent";

type DraftTool = {
  execute: (input: { title: string; body: string; format: "blog_post" }, options: { abortSignal?: AbortSignal }) => Promise<unknown>;
};

type AgentOptions = { tools: { save_brand_voice_profile: unknown; save_content_draft: DraftTool } };

beforeEach(() => {
  mocks.agentOptions = undefined;
  mocks.createDraft.mockReset();
  mocks.createModel.mockReset().mockReturnValue({});
  mocks.saveProfile.mockReset();
});

describe("Content draft tool output", () => {
  it("forwards the chat abort signal and returns the saved humanised body", async () => {
    const savedDraft = {
      id: "draft-1",
      title: "A useful post",
      body: "The complete humanised draft.",
      format: "blog_post" as const,
    };
    mocks.createDraft.mockResolvedValue(savedDraft);
    createContentAgent({
      workspaceId: "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a11",
      threadId: "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a12",
      models: { apiKey: "test-key", model: "anthropic/claude-sonnet-5.5" },
      brandVoiceProfile: null,
    });
    const tool = (mocks.agentOptions as AgentOptions).tools.save_content_draft;
    const signal = new AbortController().signal;

    await expect(tool.execute(savedDraft, { abortSignal: signal })).resolves.toEqual({
      saved: true,
      draftId: savedDraft.id,
      title: savedDraft.title,
      format: savedDraft.format,
      body: savedDraft.body,
    });
    expect(mocks.createDraft).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a11",
      threadId: "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a12",
      signal,
    }));
    expect(Object.keys((mocks.agentOptions as AgentOptions).tools).sort()).toEqual([
      "save_brand_voice_profile",
      "save_content_draft",
    ]);
  });
});
