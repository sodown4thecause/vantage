import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  ContentToolCard,
  contentDraftIsDirty,
  contentDraftsNeedingRestore,
  contentDraftSaveReducer,
  buildContentDraftUpdatePrompt,
  buildContentRepurposePrompt,
  buildContentSectionRegenerationPrompt,
  contentDraftUpdateSucceeded,
  replaceContentDraftSection,
} from "@/app/content/content-workspace-cards";
import type { ContentDraftFormat } from "@/lib/content-agent/contracts";

const draft = {
  draftId: "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a12",
  title: "A useful post",
  format: "blog_post" as ContentDraftFormat,
  body: "Opening paragraph.\n\nSecond paragraph.",
};
const noOp = vi.fn();

function renderPart(part: unknown): string {
  return renderToStaticMarkup(createElement(ContentToolCard, {
    part: part as never,
    onSaveDraft: noOp,
    onRegenerateSection: noOp,
    onRepurpose: noOp,
  }));
}

describe("Content generative cards", () => {
  it("renders a saved draft as an editable card with copy, save, section, and repurpose actions", () => {
    const html = renderPart({
      type: "tool-save_content_draft",
      toolCallId: "call-1",
      state: "output-available",
      output: { saved: true, ...draft },
    });

    expect(html).toContain('aria-label="Saved draft: A useful post"');
    expect(html).toContain('aria-label="Edit draft body"');
    expect(html).toContain("Opening paragraph.");
    expect(html).toContain("Copy draft");
    expect(html).toContain("Save changes");
    expect(html).toContain("Regenerate section 1");
    expect(html).toContain("Repurpose as");
    expect(html).toContain("Create new private version");
  });

  it("restores saved-draft cards when stored conversation history contains only text", () => {
    const history = [{ parts: [{ type: "text", text: "I saved a draft for you." }] }];
    expect(contentDraftsNeedingRestore([draft], history)).toEqual([draft]);

    const liveCard = [{ parts: [{
      type: "tool-save_content_draft",
      state: "output-available",
      output: { saved: true, ...draft },
    }] }];
    expect(contentDraftsNeedingRestore([draft], liveCard)).toEqual([]);
  });

  it("renders a successful edit-tool result without exposing its raw output", () => {
    const html = renderPart({
      type: "tool-update_content_draft",
      state: "output-available",
      output: { saved: true, draftId: draft.draftId, title: "A useful post", body: "Edited." },
    });
    expect(html).toContain("Changes saved to your private draft.");
    expect(html).not.toContain("Edited.");
  });

  it("renders blog outlines with a structured outline preview", () => {
    const html = renderPart({
      type: "tool-save_content_draft",
      state: "output-available",
      output: { saved: true, ...draft, format: "blog_outline", body: "Opening\n\nUseful sections" },
    });
    expect(html).toContain('aria-label="Outline sections"');
    expect(html).toContain("Useful sections");
    expect(html).toContain("Outline</span>");
  });

  it("renders ranked source results as an evidence card with only validated canonical links", () => {
    const html = renderPart({
      type: "tool-ranked_conversation_source",
      toolCallId: "call-2",
      state: "output-available",
      output: {
        sourceType: "ranked_conversation",
        requestedFormat: "blog_post",
        evidence: [{ title: "Content workflow question", platform: "reddit", content: "How should a small team plan content?" }],
        citations: [{ title: "Content workflow question", url: "https://community.example/thread/1" }],
      },
    });

    expect(html).toContain('aria-label="Source evidence"');
    expect(html).toContain("Content workflow question");
    expect(html).toContain("How should a small team plan content?");
    expect(html).toContain('href="https://community.example/thread/1"');
    expect(html).not.toContain("contentMd");
  });

  it("renders current ranked-keyword and competitor-gap result shapes", () => {
    const keyword = renderPart({
      type: "tool-ranked_keyword_source",
      state: "output-available",
      output: {
        sourceType: "ranked_keyword",
        requestedFormat: "blog_post",
        domain: "vantage.example",
        evidence: [{ keyword: "content planning", position: 5 }],
        citations: [{ title: "Ranking page", url: "https://vantage.example/content-planning" }],
      },
    });
    const competitor = renderPart({
      type: "tool-competitor_gap_source",
      state: "output-available",
      output: {
        sourceType: "competitor_gap",
        requestedFormat: "linkedin_post",
        domain: "vantage.example",
        competitor: "competitor.example",
        evidence: [{ keyword: "brand voice tools", position: 3 }],
        citations: [{ title: "Competitor ranking page", url: "https://vantage.example/brand-voice" }],
      },
    });

    expect(keyword).toContain("Keywords for vantage.example");
    expect(keyword).toContain("Position 5");
    expect(competitor).toContain("Competitor gaps for vantage.example");
    expect(competitor).toContain("Keyword gaps against competitor.example.");
    expect(competitor).toContain("brand voice tools");
  });

  it("does not render an unsafe citation URL supplied in a malformed tool result", () => {
    const html = renderPart({
      type: "tool-ranked_keyword_source",
      state: "output-available",
      output: {
        sourceType: "ranked_keyword",
        requestedFormat: "blog_post",
        domain: "example.test",
        evidence: [{ keyword: "content", position: 2 }],
        citations: [{ title: "Unsafe source", url: "javascript:alert(1)" }],
      },
    });
    expect(html).toContain("No safe source evidence was available");
    expect(html).not.toContain("javascript:");
  });

  it("never renders unknown tool output as JSON and handles failed tools with safe copy", () => {
    const raw = JSON.stringify({ unexpected: "do not expose", private: "raw tool data" });
    expect(renderPart({
      type: "tool-unknown_tool",
      state: "output-available",
      output: { unexpected: "do not expose", private: "raw tool data" },
    })).not.toContain(raw);

    const failed = renderPart({
      type: "tool-ranked_keyword_source",
      state: "output-error",
      errorText: "database password and raw exception",
    });
    expect(failed).toContain("retrieve source evidence.");
    expect(failed).not.toContain("database password");
  });

  it("bounds regeneration prompts and includes a long selected section only once", () => {
    const longDraft = { ...draft, body: `${"x".repeat(20_000)}\n\n${"y".repeat(10_000)}` };
    const prompt = buildContentSectionRegenerationPrompt(longDraft, 0);

    expect(prompt.length).toBeLessThanOrEqual(32_000);
    expect(prompt.split("x".repeat(20_000))).toHaveLength(2);
    expect(prompt.split("y".repeat(4_000))).toHaveLength(2);
    expect(prompt).not.toContain("y".repeat(4_001));
  });

  it("keeps each last-confirmed save separate from later failures and other card saves", () => {
    const initial = { confirmed: {}, results: {} };
    const saved = contentDraftSaveReducer(initial, { type: "started", draftId: draft.draftId });
    const confirmed = contentDraftSaveReducer(saved, {
      type: "finished",
      result: { draftId: draft.draftId, title: "Saved B", body: "Body B", ok: true },
    });
    const failed = contentDraftSaveReducer(confirmed, { type: "started", draftId: draft.draftId });
    const afterFailure = contentDraftSaveReducer(failed, {
      type: "finished",
      result: { draftId: draft.draftId, title: "Original A", body: "Body A", ok: false },
    });
    const otherCard = contentDraftSaveReducer(afterFailure, { type: "started", draftId: "other-draft" });

    expect(afterFailure.confirmed[draft.draftId]).toEqual({ title: "Saved B", body: "Body B" });
    expect(contentDraftIsDirty({ title: "Original A", body: "Body A" }, afterFailure.confirmed[draft.draftId]!)).toBe(true);
    expect(afterFailure.results[draft.draftId]).toEqual({ draftId: draft.draftId, title: "Original A", body: "Body A", ok: false });
    expect(otherCard.results[draft.draftId]).toEqual(afterFailure.results[draft.draftId]);
  });

  it("replaces only the selected text range and preserves formatting outside it", () => {
    const body = [
      "# Intro",
      "",
      "",
      "\tSelected section  ",
      " \t",
      "",
      "",
      "  ```ts",
      "  const value = 1;",
      "",
      "  console.log(value);",
      "  ```",
      "",
      "",
      "# Tail",
      "",
    ].join("\n");

    expect(replaceContentDraftSection(body, 1, "Regenerated section", "Selected section")).toBe(
      body.replace("Selected section", "Regenerated section"),
    );
  });

  it("keeps regeneration as an unapplied proposal and repurposes only through private drafting", () => {
    const regeneration = buildContentSectionRegenerationPrompt(draft, 1);
    expect(regeneration).toContain("Regenerate section 2");
    expect(regeneration.toLowerCase()).toContain("return only the replacement text");
    expect(regeneration).toContain("Do not save or publish");
    expect(regeneration).toContain("Second paragraph.");

    const update = buildContentDraftUpdatePrompt({ ...draft, title: "Exact title", body: "  Exact body.  " });
    expect(update).toContain("update_content_draft exactly once");
    expect(update).toContain("Exact title:\nExact title");
    expect(update).toContain("Exact body:\n  Exact body.  ");
    expect(contentDraftUpdateSucceeded({ saved: true, draftId: draft.draftId, title: draft.title, body: draft.body }, draft)).toBe(true);
    expect(contentDraftUpdateSucceeded({ saved: true, draftId: draft.draftId, title: draft.title, body: "Different" }, draft)).toBe(false);

    const repurpose = buildContentRepurposePrompt(draft, "linkedin_post");
    expect(repurpose).toContain("LinkedIn post");
    expect(repurpose).toContain("save_content_draft");
    expect(repurpose).toContain("Do not publish, post, schedule");
    expect(repurpose).toContain(draft.body);

    expect(replaceContentDraftSection(draft.body, 1, "A revised paragraph.")).toBe(
      "Opening paragraph.\n\nA revised paragraph.",
    );
    expect(() => replaceContentDraftSection(draft.body, 9, "No section.")).toThrow("section");
    expect(() => replaceContentDraftSection(draft.body, 1, "Wrong section.", "Changed meanwhile.")).toThrow("changed");
  });
});
