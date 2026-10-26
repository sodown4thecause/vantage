import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createDraft: vi.fn(), humanise: vi.fn() }));
vi.mock("@/lib/content-agent/repository", () => ({ createContentDraft: mocks.createDraft }));
vi.mock("@/lib/content-agent/humaniser", () => ({ humaniseContentDraft: mocks.humanise }));

import { ContentBrandVoiceRequiredError, createHumanisedContentDraft } from "@/lib/content-agent/drafts";

const profile = {
  audience: "Founder-led teams",
  purpose: "Help readers make practical decisions.",
  voice: "Warm and direct.",
  structure: "Short opening, useful sections.",
  avoid: ["hype"],
};
const args = {
  workspaceId: "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a11",
  threadId: "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a12",
  draft: { title: "A useful post", body: "Original text.", format: "blog_post" as const },
  models: { apiKey: "test-key", model: "anthropic/claude-sonnet-5.5" },
};

beforeEach(() => {
  mocks.createDraft.mockReset().mockResolvedValue({ id: "draft-1", ...args.draft, status: "draft" });
  mocks.humanise.mockReset().mockResolvedValue("Revised text.");
});

describe("Content private draft saving", () => {
  it("requires a saved workspace voice and humanises the persisted body", async () => {
    const error = await createHumanisedContentDraft({ ...args, profile: null }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ContentBrandVoiceRequiredError);
    expect(error).toMatchObject({ code: "CONTENT_BRAND_VOICE_REQUIRED" });
    expect(error).toHaveProperty("message", "Save a brand voice profile before creating a draft.");
    expect(mocks.humanise).not.toHaveBeenCalled();
    expect(mocks.createDraft).not.toHaveBeenCalled();

    await createHumanisedContentDraft({ ...args, profile });
    expect(mocks.humanise).toHaveBeenCalledWith({
      workspaceId: args.workspaceId,
      draft: args.draft,
      profile,
      models: args.models,
    });
    expect(mocks.createDraft).toHaveBeenCalledWith({
      workspaceId: args.workspaceId,
      threadId: args.threadId,
      ...args.draft,
      body: "Revised text.",
    });
  });
});
