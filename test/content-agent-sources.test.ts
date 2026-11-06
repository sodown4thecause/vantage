import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOpportunityDetail: vi.fn(),
  fetchRankedKeywords: vi.fn(),
  fetchKeywordGap: vi.fn(),
  normalizeTarget: vi.fn((input: string) => {
    const host = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
    return host?.includes(".") ? host : null;
  }),
}));

vi.mock("ai", () => ({ tool: (definition: unknown) => definition }));
vi.mock("@/lib/opportunities/run", () => ({ getOpportunityDetail: mocks.getOpportunityDetail }));
vi.mock("@/lib/dataforseo/labs", () => ({
  fetchRankedKeywords: mocks.fetchRankedKeywords,
  fetchKeywordGap: mocks.fetchKeywordGap,
}));
vi.mock("@/lib/dataforseo/backlinks", () => ({ normalizeTarget: mocks.normalizeTarget }));

import { appendContentSourceCitations, createContentSourceTools, extractContentSourceCitations } from "@/lib/content-agent/sources";

type Runnable = {
  inputSchema: { safeParse: (input: unknown) => { success: boolean } };
  execute: (input: unknown, options?: { abortSignal?: AbortSignal }) => Promise<unknown>;
};
type Tools = Record<string, Runnable>;

const workspaceId = "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a11";
const opportunityId = "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a13";
const conversationUrl = "https://community.example/thread/1";
const rankingUrl = "https://vantage.example/content-planning";

const toolSet = (onLookup?: (result: { citations: Array<{ title: string; url: string }>; unsafeCitation: boolean }) => void) =>
  createContentSourceTools({ workspaceId, onLookup }) as unknown as Tools;

beforeEach(() => {
  mocks.getOpportunityDetail.mockReset();
  mocks.fetchRankedKeywords.mockReset();
  mocks.fetchKeywordGap.mockReset();
  mocks.normalizeTarget.mockClear();
});

describe("Content source tools", () => {
  it("limits the schemas to the seven private Content draft formats", () => {
    const tools = toolSet();
    const formats = ["blog_outline", "blog_post", "x_thread", "linkedin_post", "reddit_reply", "hn_reply", "newsletter_section"];

    for (const format of formats) {
      expect(tools.ranked_conversation_source.inputSchema.safeParse({ opportunityId, format }).success).toBe(true);
    }
    expect(tools.ranked_conversation_source.inputSchema.safeParse({ opportunityId, format: "published" }).success).toBe(false);
    expect(tools.ranked_keyword_source.inputSchema.safeParse({ domain: "vantage.example", format: "x_thread", extra: true }).success).toBe(false);
  });

  it("loads ranked conversation evidence only through the workspace-scoped detail reader and returns canonical citations", async () => {
    mocks.getOpportunityDetail.mockResolvedValue({
      id: opportunityId,
      title: "How teams plan content",
      summary: "A founder asked about repeatable content planning.",
      evidence: [{ title: "Content workflow question", platform: "reddit", contentMd: "How should a small team plan content?", urlCanonical: conversationUrl }],
    });
    const onLookup = vi.fn();
    const result = await toolSet(onLookup).ranked_conversation_source.execute({ opportunityId, format: "blog_outline" });

    expect(mocks.getOpportunityDetail).toHaveBeenCalledWith({ workspaceId, opportunityId });
    expect(result).toMatchObject({
      sourceType: "ranked_conversation",
      requestedFormat: "blog_outline",
      evidence: [{ title: "Content workflow question", content: "How should a small team plan content?" }],
      citations: [{ title: "Content workflow question", url: conversationUrl }],
    });
    expect(onLookup).toHaveBeenCalledWith({ citations: [{ title: "Content workflow question", url: conversationUrl }], unsafeCitation: false });
  });

  it("bounds conversation evidence titles without discarding long-title source evidence", async () => {
    const title = "Long title ".repeat(25);
    mocks.getOpportunityDetail.mockResolvedValue({
      id: opportunityId,
      title: "Conversation",
      summary: "Summary",
      evidence: [{ title, platform: "reddit", contentMd: "Relevant content", urlCanonical: conversationUrl }],
    });

    const result = await toolSet().ranked_conversation_source.execute({ opportunityId, format: "blog_post" }) as {
      evidence: Array<{ title: string }>;
      citations: Array<{ title: string; url: string }>;
    };

    expect(result.evidence[0]?.title).toHaveLength(200);
    expect(result.citations[0]).toEqual({ title: title.trim().slice(0, 200), url: conversationUrl });
  });

  it("fails closed without exposing evidence when a canonical conversation URL is unsafe", async () => {
    mocks.getOpportunityDetail.mockResolvedValue({
      id: opportunityId,
      title: "Unsafe source",
      summary: "Do not use this evidence.",
      evidence: [{ title: "Unsafe link", platform: "reddit", contentMd: "untrusted text", urlCanonical: "javascript:alert(1)" }],
    });
    const onLookup = vi.fn();
    const result = await toolSet(onLookup).ranked_conversation_source.execute({ opportunityId, format: "reddit_reply" });

    expect(result).toEqual({ error: "unsafe_source_citation", requestedFormat: "reddit_reply" });
    expect(JSON.stringify(result)).not.toContain("untrusted text");
    expect(onLookup).toHaveBeenCalledWith({ citations: [], unsafeCitation: true });
  });

  it("normalises the requested domain and loads ranked keywords through the existing scoped reader", async () => {
    mocks.fetchRankedKeywords.mockResolvedValue({ value: [{ keyword: "content planning", searchVolume: 1200, position: 5, url: rankingUrl }], cached: false });
    const onLookup = vi.fn();
    const signal = new AbortController().signal;
    const result = await toolSet(onLookup).ranked_keyword_source.execute(
      { domain: "https://www.vantage.example/blog", format: "blog_post" },
      { abortSignal: signal },
    );

    expect(mocks.normalizeTarget).toHaveBeenCalledWith("https://www.vantage.example/blog");
    expect(mocks.fetchRankedKeywords).toHaveBeenCalledWith(workspaceId, "vantage.example", 100, { signal });
    expect(result).toMatchObject({
      sourceType: "ranked_keyword",
      requestedFormat: "blog_post",
      evidence: [{ keyword: "content planning", position: 5 }],
      citations: [{ title: "Ranking page for content planning", url: rankingUrl }],
    });
    expect(onLookup).toHaveBeenCalledWith({ citations: [{ title: "Ranking page for content planning", url: rankingUrl }], unsafeCitation: false });
  });

  it("loads competitor-gap evidence through the existing workspace-scoped reader", async () => {
    mocks.fetchKeywordGap.mockResolvedValue({ value: [{ keyword: "brand voice tools", position: 3, url: rankingUrl }], cached: true });
    const onLookup = vi.fn();
    const result = await toolSet(onLookup).competitor_gap_source.execute({
      domain: "vantage.example",
      competitor: "competitor.example",
      format: "linkedin_post",
    });

    expect(mocks.fetchKeywordGap).toHaveBeenCalledWith(workspaceId, "vantage.example", "competitor.example", 100, expect.anything());
    expect(result).toMatchObject({
      sourceType: "competitor_gap",
      requestedFormat: "linkedin_post",
      evidence: [{ keyword: "brand voice tools", position: 3 }],
      citations: [{ title: "Competitor ranking page for brand voice tools", url: rankingUrl }],
    });
  });

  it("rejects drafts containing any citation URL not returned by source tools and appends unique canonical citations", () => {
    const citations = [{ title: "Source", url: conversationUrl }, { title: "Duplicate", url: conversationUrl }];

    expect(appendContentSourceCitations("A grounded draft.", citations)).toBe(`A grounded draft.\n\nSources:\n- ${conversationUrl}`);
    expect(() => appendContentSourceCitations(`A draft citing https://invented.example/metric`, citations)).toThrow("Draft contains a citation URL that was not returned by a source tool.");
    expect(() => appendContentSourceCitations("A markdown link [local file](file:///etc/passwd)", citations)).toThrow("Draft contains a citation URL that was not returned by a source tool.");
    expect(() => appendContentSourceCitations("A draft.", [{ title: "Unsafe", url: "javascript:alert(1)" }])).toThrow("Unsafe source citation.");
  });

  it("preserves balanced parentheses and URLs whose paths end in punctuation", () => {
    const parenthesizedUrl = "https://example.com/wiki/Foo_(bar)";
    const punctuationUrl = "https://example.com/wiki/Foo.";
    const citations = [
      { title: "Parenthesized source", url: parenthesizedUrl },
      { title: "Punctuation source", url: punctuationUrl },
    ];

    expect(appendContentSourceCitations(`See [the page](${parenthesizedUrl}) and ${punctuationUrl}`, citations)).toContain(parenthesizedUrl);
    expect(appendContentSourceCitations(`See ${parenthesizedUrl}.`, [{ title: "Parenthesized source", url: parenthesizedUrl }])).toBe(
      `See ${parenthesizedUrl}.\n\nSources:\n- ${parenthesizedUrl}`,
    );
    expect(appendContentSourceCitations("See https://example.com/wiki/Foo.", [{ title: "Source", url: "https://example.com/wiki/Foo" }])).toBe(
      "See https://example.com/wiki/Foo.\n\nSources:\n- https://example.com/wiki/Foo",
    );
  });

  it("reloads only listed saved source citations while preserving balanced and trailing-punctuation URLs", () => {
    const body = [
      "Source-backed copy references https://community.example/thread/1.",
      "",
      "Sources:",
      "- https://example.com/wiki/Foo_(bar)",
      "- https://example.com/end.",
    ].join("\n");

    expect(extractContentSourceCitations(body)).toEqual([
      { title: "Saved source", url: "https://example.com/wiki/Foo_(bar)" },
      { title: "Saved source", url: "https://example.com/end." },
    ]);
  });

  it("does not treat arbitrary inline URLs as verified saved citations", () => {
    expect(extractContentSourceCitations("An ordinary draft mentions https://example.com/claim.")).toEqual([]);
    expect(extractContentSourceCitations("Bold text **https://example.com/claim** is not a source-list citation.")).toEqual([]);
  });

  it("adds a durable Sources list when a verified citation already appears inline", () => {
    const body = `Grounded copy references ${conversationUrl}.`;
    expect(appendContentSourceCitations(body, [{ title: "Verified", url: conversationUrl }])).toBe(
      `${body}\n\nSources:\n- ${conversationUrl}`,
    );
  });

  it.each([
    { name: "DataForSeoDeniedError", code: "credits_exhausted", category: "provider_credits" },
    { name: "DataForSeoDeniedError", code: "not_configured", category: "provider_not_configured" },
    { name: "NeonDbError", code: undefined, category: "database" },
  ])("logs only a safe category and tool name for $name while keeping lookup results generic", async ({ name, code, category }) => {
    const error = Object.assign(new Error("private upstream data at https://user:password@example.com"), { name, code });
    mocks.fetchRankedKeywords.mockRejectedValue(error);
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await toolSet().ranked_keyword_source.execute({ domain: "vantage.example", format: "blog_post" });
      expect(result).toEqual({ error: "source_lookup_failed", requestedFormat: "blog_post" });
      expect(logger).toHaveBeenCalledWith("[content-agent] source lookup failed", { tool: "ranked_keyword_source", category });
      expect(JSON.stringify(logger.mock.calls)).not.toContain("private upstream data");
      expect(JSON.stringify(logger.mock.calls)).not.toContain("password");
    } finally {
      logger.mockRestore();
    }
  });
});
