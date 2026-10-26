import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  agentOptions: undefined as unknown,
  createDraft: vi.fn(),
  createModel: vi.fn(),
  createSourceTools: vi.fn(),
  sourceOptions: undefined as unknown,
  appendSourceCitations: vi.fn(),
  saveProfile: vi.fn(),
  updateDraft: vi.fn(),
}));

vi.mock("ai", () => ({
  ToolLoopAgent: class { constructor(options: unknown) { mocks.agentOptions = options; } },
  stepCountIs: () => undefined,
  tool: (definition: unknown) => definition,
}));
vi.mock("@/lib/content-agent/drafts", () => ({ createHumanisedContentDraft: mocks.createDraft }));
vi.mock("@/lib/content-agent/models", () => ({ createContentGatewayModel: mocks.createModel }));
vi.mock("@/lib/content-agent/sources", () => ({
  appendContentSourceCitations: mocks.appendSourceCitations,
  createContentSourceTools: mocks.createSourceTools,
}));
vi.mock("@/lib/content-agent/repository", () => ({
  saveContentBrandVoiceProfile: mocks.saveProfile,
  updateContentDraft: mocks.updateDraft,
}));

import { createContentAgent } from "@/lib/content-agent/agent";

type DraftTool = {
  execute: (input: { title: string; body: string; format: "blog_post"; sourceBacked: boolean }, options: { abortSignal?: AbortSignal }) => Promise<unknown>;
};
type DraftUpdateTool = {
  execute: (input: { draftId: string; title: string; body: string }) => Promise<unknown>;
};

type AgentOptions = { tools: Record<string, unknown> & {
  save_content_draft: DraftTool;
  update_content_draft: DraftUpdateTool;
} };
type SourceNotice = { citations: Array<{ title: string; url: string }>; unsafeCitation: boolean };
type SourceOptions = { workspaceId: string; onLookup: (notice: SourceNotice) => void };

const sourceTools = {
  ranked_conversation_source: {},
  ranked_keyword_source: {},
  competitor_gap_source: {},
};
const profile = {
  workspaceId: "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a11",
  audience: "Founders",
  purpose: "Help readers",
  voice: "Clear",
  structure: "Short",
  avoid: [] as string[],
  sampleText: null,
  createdAt: new Date("2026-10-01T00:00:00.000Z"),
  updatedAt: new Date("2026-10-01T00:00:00.000Z"),
};
const createAgent = () => createContentAgent({
  workspaceId: "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a11",
  threadId: "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a12",
  models: { apiKey: "test-key", model: "anthropic/claude-sonnet-5.5" },
  brandVoiceProfile: profile,
});

beforeEach(() => {
  mocks.agentOptions = undefined;
  mocks.createDraft.mockReset();
  mocks.createModel.mockReset().mockReturnValue({});
  mocks.createSourceTools.mockReset().mockImplementation((options: SourceOptions) => {
    mocks.sourceOptions = options;
    return sourceTools;
  });
  mocks.appendSourceCitations.mockReset().mockImplementation((body: string, citations: Array<{ title: string; url: string }>) => {
    const urls = body.match(/https?:\/\/[^\s<>"']+/g) ?? [];
    for (const raw of urls) {
      if (!citations.some((citation) => citation.url === raw.replace(/[.,;:!?]+$/, ""))) {
        throw new Error("Draft contains a citation URL that was not returned by a source tool.");
      }
    }
    const missing = citations.filter((citation) => !body.includes(citation.url));
    return missing.length ? `${body.trimEnd()}\n\nSources:\n${missing.map((citation) => `- ${citation.url}`).join("\n")}` : body.trim();
  });
  mocks.saveProfile.mockReset();
  mocks.updateDraft.mockReset();
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
    createAgent();
    const tool = (mocks.agentOptions as AgentOptions).tools.save_content_draft;
    const signal = new AbortController().signal;

    await expect(tool.execute({ ...savedDraft, sourceBacked: false }, { abortSignal: signal })).resolves.toEqual({
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
      "competitor_gap_source",
      "ranked_conversation_source",
      "ranked_keyword_source",
      "save_brand_voice_profile",
      "save_content_draft",
      "update_content_draft",
    ]);
  });

  it("saves exact edits to an existing workspace draft through the update tool", async () => {
    const edited = { id: "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a13", title: "Edited title", body: "Exact owner-edited body." };
    mocks.updateDraft.mockResolvedValue(edited);
    createAgent();
    const tool = (mocks.agentOptions as AgentOptions).tools.update_content_draft;

    await expect(tool.execute({ draftId: edited.id, title: edited.title, body: edited.body })).resolves.toEqual({
      saved: true,
      draftId: edited.id,
      title: edited.title,
      body: edited.body,
    });
    expect(mocks.updateDraft).toHaveBeenCalledWith({
      workspaceId: "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a11",
      draftId: edited.id,
      title: edited.title,
      body: edited.body,
    });
    expect(mocks.createDraft).not.toHaveBeenCalled();
  });

  it("allows ordinary drafts to keep user-provided links without a source lookup", async () => {
    const input = {
      title: "A useful post",
      body: "Learn more at https://vantage.example/product",
      format: "blog_post" as const,
      sourceBacked: false,
    };
    mocks.createDraft.mockResolvedValue({ id: "draft-link", title: input.title, body: input.body, format: input.format });
    createAgent();

    const tool = (mocks.agentOptions as AgentOptions).tools.save_content_draft;
    await expect(tool.execute(input, {})).resolves.toMatchObject({ saved: true, draftId: "draft-link" });

    expect(mocks.appendSourceCitations).not.toHaveBeenCalled();
    expect(mocks.createDraft).toHaveBeenCalledWith(expect.objectContaining({
      draft: { title: input.title, body: input.body, format: input.format },
    }));
  });

  it("appends returned citations before humanising a source-backed draft", async () => {
    mocks.createDraft.mockResolvedValue({ id: "draft-2", title: "A useful post", body: "Draft with its source.", format: "blog_post" });
    createAgent();
    const sourceOptions = mocks.sourceOptions as SourceOptions;
    const citations = [{ title: "Source thread", url: "https://community.example/thread/1" }];
    sourceOptions.onLookup({ citations, unsafeCitation: false });

    const tool = (mocks.agentOptions as AgentOptions).tools.save_content_draft;
    await tool.execute({ title: "A useful post", body: "A grounded article.", format: "blog_post", sourceBacked: true }, {});

    expect(mocks.appendSourceCitations).toHaveBeenCalledWith("A grounded article.", citations);
    expect(mocks.createDraft).toHaveBeenCalledWith(expect.objectContaining({
      draft: { title: "A useful post", body: "A grounded article.\n\nSources:\n- https://community.example/thread/1", format: "blog_post" },
    }));
  });

  it.each([
    { citations: [], unsafeCitation: true },
    { citations: [], unsafeCitation: false },
  ])("refuses to save when source lookup has unsafe or no citable evidence: %j", async (notice) => {
    createAgent();
    (mocks.sourceOptions as SourceOptions).onLookup(notice);

    const tool = (mocks.agentOptions as AgentOptions).tools.save_content_draft;
    await expect(tool.execute({ title: "A useful post", body: "Uncited claims.", format: "blog_post", sourceBacked: true }, {})).rejects.toThrow();
    expect(mocks.createDraft).not.toHaveBeenCalled();
  });

  it("binds a save to the latest lookup instead of retaining citations from an earlier lookup", async () => {
    createAgent();
    const sourceOptions = mocks.sourceOptions as SourceOptions;
    sourceOptions.onLookup({ citations: [{ title: "Source A", url: "https://a.example/source" }], unsafeCitation: false });
    sourceOptions.onLookup({ citations: [], unsafeCitation: false });

    const tool = (mocks.agentOptions as AgentOptions).tools.save_content_draft;
    await expect(tool.execute({ title: "A useful post", body: "Claims about source B.", format: "blog_post", sourceBacked: true }, {})).rejects.toThrow();
    expect(mocks.createDraft).not.toHaveBeenCalled();
  });

  it("requires a successful lookup when a draft is explicitly marked source-backed", async () => {
    createAgent();
    const tool = (mocks.agentOptions as AgentOptions).tools.save_content_draft;

    await expect(tool.execute({
      title: "A source-backed post",
      body: "Claims that need evidence.",
      format: "blog_post",
      sourceBacked: true,
    }, {})).rejects.toThrow("Cannot save a source-based draft without a safe source citation.");
    expect(mocks.createDraft).not.toHaveBeenCalled();
  });

  it("rejects a source-backed revision with citations when this agent has no matching verified lookup", async () => {
    createAgent();
    const tool = (mocks.agentOptions as AgentOptions).tools.save_content_draft;
    await expect(tool.execute({
      title: "A revised post",
      body: "Updated draft.\n\nSources:\n- https://community.example/thread/1",
      format: "blog_post",
      sourceBacked: true,
    }, {})).rejects.toThrow("Draft contains a citation URL that was not returned by a source tool.");
    expect(mocks.createDraft).not.toHaveBeenCalled();
  });

  it("consumes verified source citations for one save instead of reusing them for another", async () => {
    mocks.createDraft.mockResolvedValue({ id: "draft-3", title: "A useful post", body: "Draft with its source.", format: "blog_post" });
    createAgent();
    (mocks.sourceOptions as SourceOptions).onLookup({
      citations: [{ title: "Source thread", url: "https://community.example/thread/1" }],
      unsafeCitation: false,
    });
    const tool = (mocks.agentOptions as AgentOptions).tools.save_content_draft;

    await tool.execute({ title: "A useful post", body: "Grounded draft.", format: "blog_post", sourceBacked: true }, {});
    await expect(tool.execute({
      title: "Another post",
      body: "Revision cites https://community.example/thread/1",
      format: "blog_post",
      sourceBacked: true,
    }, {})).rejects.toThrow("Draft contains a citation URL that was not returned by a source tool.");
    expect(mocks.createDraft).toHaveBeenCalledTimes(1);
  });
});
