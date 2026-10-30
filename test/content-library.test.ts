import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  allowed: true,
  authorizeWorkspace: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/auth/workspace", () => ({ authorizeWorkspace: state.authorizeWorkspace }));
vi.mock("@/lib/content-agent/repository", () => ({ updateContentDraftStatus: state.update }));

import { PATCH } from "@/app/api/content/drafts/[id]/route";
import { contentDraftFilename, contentDraftsForLibrary, contentDraftSourceLinks, contentDraftsAsMarkdown } from "@/lib/content-agent/library";
import type { ContentDraftRow } from "@/lib/content-agent/repository";

const WORKSPACE_A = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_B = "22222222-2222-4222-8222-222222222222";
const DRAFT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DRAFT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function draft(overrides: Partial<ContentDraftRow> = {}): ContentDraftRow {
  return {
    id: DRAFT_A,
    workspaceId: WORKSPACE_A,
    threadId: null,
    title: "Useful draft",
    body: "A useful point [source](https://example.com/guide). Another https://news.example.org/story?ref=content.",
    format: "blog_post",
    status: "draft",
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-02T00:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  state.allowed = true;
  state.authorizeWorkspace.mockReset().mockImplementation(async () => state.allowed
    ? { ok: true, userId: "user-a" }
    : { ok: false, status: 403, error: "forbidden" });
  state.update.mockReset().mockResolvedValue(draft({ status: "ready" }));
});

describe("Content library sources and filters", () => {
  it("extracts and deduplicates safe HTTP(S) links from Markdown", () => {
    expect(contentDraftSourceLinks("[guide](https://example.com/guide) and https://example.com/guide. javascript:alert(1) ftp://files.example/a"))
      .toEqual(["https://example.com/guide"]);
  });

  it("keeps balanced URL parentheses and strips Markdown emphasis delimiters", () => {
    expect(contentDraftSourceLinks(
      "[wiki](https://en.wikipedia.org/wiki/Foo_(bar)) **https://a.com/x** _https://a.com/y_ **[guide](https://docs.example/Path_(intro))**",
    )).toEqual([
      "https://en.wikipedia.org/wiki/Foo_(bar)",
      "https://a.com/x",
      "https://a.com/y",
      "https://docs.example/Path_(intro)",
    ]);
  });

  it("strips emphasis that wraps trailing punctuation from bare URLs", () => {
    expect(contentDraftSourceLinks("See **https://example.com/guide**. Also _https://a.com/y_, and ~~https://b.com/z~~!"))
      .toEqual(["https://example.com/guide", "https://a.com/y", "https://b.com/z"]);
  });

  it("reads adjacent Markdown links as separate sources", () => {
    expect(contentDraftSourceLinks("[a](https://a.com/1)[b](https://b.com/2)"))
      .toEqual(["https://a.com/1", "https://b.com/2"]);
  });

  it("keeps the second of two adjacent links in the source filter", () => {
    const drafts = [draft({ body: "[a](https://a.com/1)[b](https://b.com/2)" })];
    expect(contentDraftsForLibrary(drafts, { status: "all", format: "all", source: "b.com" })).toEqual(drafts);
  });

  it("reads Markdown links that carry a title", () => {
    expect(contentDraftSourceLinks('[guide](https://example.com/guide "The guide")')).toEqual(["https://example.com/guide"]);
  });

  it("exports complete parenthesized and emphasized source URLs", () => {
    const output = contentDraftsAsMarkdown(draft({
      body: "[wiki](https://en.wikipedia.org/wiki/Foo_(bar)) and **https://a.com/x**",
    }));

    expect(output).toContain("- [en.wikipedia.org](https://en.wikipedia.org/wiki/Foo_(bar))");
    expect(output).toContain("- [a.com](https://a.com/x)");
  });

  it("filters saved drafts by status, format, and source host", () => {
    const drafts = [
      draft(),
      draft({ id: DRAFT_B, title: "A thread", format: "x_thread", status: "ready", body: "https://other.example/post" }),
    ];

    expect(contentDraftsForLibrary(drafts, { status: "ready", format: "x_thread", source: "other.example" }))
      .toEqual([drafts[1]]);
    expect(contentDraftsForLibrary(drafts, { status: "idea", format: "all", source: "all" })).toEqual([]);
  });

  it("exports the body and a deduplicated source list as Markdown", () => {
    const output = contentDraftsAsMarkdown(draft({
      title: "Useful draft",
      body: "Read [the guide](https://example.com/guide) and https://example.com/guide.",
    }));

    expect(output).toContain("# Useful draft");
    expect(output).toContain("Read [the guide](https://example.com/guide)");
    expect(output.split("## Sources")[1]?.match(/https:\/\/example\.com\/guide/g)).toHaveLength(1);
    expect(output).toContain("## Sources\n\n- [example.com](https://example.com/guide)");
    expect(contentDraftFilename("Useful draft — updated!")).toBe("useful-draft-updated.md");
  });
});

describe("Content draft status route", () => {
  const patch = (workspaceId: string, status: string) => new Request(`https://vantage.test/api/content/drafts/${DRAFT_A}`, {
    method: "PATCH",
    body: JSON.stringify({ workspaceId, status }),
  });
  const params = Promise.resolve({ id: DRAFT_A });

  it("authorizes the workspace before updating the workspace-scoped draft", async () => {
    const response = await PATCH(patch(WORKSPACE_A, "ready"), { params });

    expect(response.status).toBe(200);
    expect(state.authorizeWorkspace).toHaveBeenCalledWith(WORKSPACE_A);
    expect(state.update).toHaveBeenCalledWith(WORKSPACE_A, DRAFT_A, "ready");
    expect(await response.json()).toMatchObject({ draft: { id: DRAFT_A, status: "ready" } });
  });

  it("does not update a draft when the workspace is not authorized", async () => {
    state.allowed = false;

    expect((await PATCH(patch(WORKSPACE_B, "ready"), { params })).status).toBe(403);
    expect(state.update).not.toHaveBeenCalled();
  });

  it("returns not found when the draft is outside the authorized workspace", async () => {
    state.update.mockResolvedValueOnce(null);

    expect((await PATCH(patch(WORKSPACE_A, "ready"), { params })).status).toBe(404);
  });

  it("rejects unsupported statuses without writing", async () => {
    expect((await PATCH(patch(WORKSPACE_A, "published"), { params })).status).toBe(400);
    expect(state.update).not.toHaveBeenCalled();
  });
});
