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
  it("rejects invalid draft input before the paid humanisation call", async () => {
    await expect(createHumanisedContentDraft({
      ...args,
      draft: { ...args.draft, title: " " },
      profile,
    })).rejects.toMatchObject({ name: "ZodError" });
    expect(mocks.humanise).not.toHaveBeenCalled();
    expect(mocks.createDraft).not.toHaveBeenCalled();
  });

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
      signal: undefined,
    });
    expect(mocks.createDraft).toHaveBeenCalledWith({
      workspaceId: args.workspaceId,
      threadId: args.threadId,
      ...args.draft,
      body: "Revised text.",
    });
  });

  it("finalises the humanised body before the workspace draft is persisted", async () => {
    const finalizeBody = vi.fn((body: string) => `${body}\n\nSources:\n- https://community.example/thread/1`);
    await createHumanisedContentDraft({ ...args, profile, finalizeBody });

    expect(finalizeBody).toHaveBeenCalledWith("Revised text.");
    expect(mocks.createDraft).toHaveBeenCalledWith(expect.objectContaining({
      body: "Revised text.\n\nSources:\n- https://community.example/thread/1",
    }));
  });

  it("does not persist when final-body source validation fails", async () => {
    await expect(createHumanisedContentDraft({
      ...args,
      profile,
      finalizeBody: () => { throw new Error("Unsafe generated citation."); },
    })).rejects.toThrow("Unsafe generated citation.");
    expect(mocks.createDraft).not.toHaveBeenCalled();
  });

  it("does not save when the chat is stopped during humanisation", async () => {
    const controller = new AbortController();
    mocks.humanise.mockImplementationOnce(async ({ signal }: { signal?: AbortSignal }) => {
      expect(signal).toBe(controller.signal);
      controller.abort();
      return "Revised text.";
    });

    await expect(createHumanisedContentDraft({ ...args, profile, signal: controller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.createDraft).not.toHaveBeenCalled();
  });
});
