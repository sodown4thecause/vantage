import { describe, expect, it } from "vitest";
import type { DraftInput } from "@/lib/drafting/generate";
import { contributionRule } from "@/lib/drafting/rules";
import { buildContributionBrief, validateContribution } from "@/lib/drafting/contribution";

const input: DraftInput = {
  productDescription: "A developer tool", targetCustomer: "AI developers",
  productMaterialText: "The tool supports local evaluation.",
  opportunityTitle: "How can I evaluate a coding agent?", opportunitySummary: "Looking for a reproducible evaluation.",
  recommendedAction: "Contribute an evaluation method",
  evidence: [{ documentId: "e1", title: "Evaluation question", urlCanonical: "https://github.com/example/tool/issues/12", platform: "github", contentMd: "Need a reproducible local evaluation with hidden tests." }],
};
const candidate = {
  decision: "draft", text: "Use a reproducible local evaluation with hidden tests. Keep hidden tests separate from the local evaluation context.",
  angle: "Explain how to prevent test leakage", gap: "A way to separate hidden tests from agent context",
  claims: [
    { sentence: "Use a reproducible local evaluation with hidden tests.", documentId: "e1", quote: "reproducible local evaluation with hidden tests" },
    { sentence: "Keep hidden tests separate from the local evaluation context.", documentId: "e1", quote: "local evaluation with hidden tests" },
  ],
};

describe("contribution rules and evidence", () => {
  it("blocks generated contributions on HN and Stack Overflow even with spoofed metadata", () => {
    expect(contributionRule("reddit", "https://news.ycombinator.com/item?id=12").aiText).toBe("prohibited");
    expect(contributionRule("rss", "https://stackoverflow.com/questions/12/example").aiText).toBe("prohibited");
  });
  it("requires human rules review for an unverified community", () => {
    expect(contributionRule("reddit", "https://www.reddit.com/r/LocalLLaMA/comments/abc/example/").aiText).toBe("unknown");
  });
  it("builds a research brief rather than ready-to-post prose", () => {
    const brief = buildContributionBrief(input, "Review community rules before contributing.");
    expect(brief.quality?.kind).toBe("brief");
    expect(brief.originalText).toContain("Evidence");
    expect(brief.originalText).not.toContain("here's how we approach");
  });
  it("accepts a useful draft with a quote traceable to its supplied evidence", () => {
    const draft = validateContribution(candidate, input, "openai/gpt-6.1-sol");
    expect(draft.originalText).toBe(candidate.text);
    expect(draft.quality?.claims).toHaveLength(2);
  });
  it("rejects an invented document or quote even when the model says it is supported", () => {
    expect(() => validateContribution({ ...candidate, claims: [{ ...candidate.claims[0], documentId: "other-workspace" }] }, input, "model")).toThrow(/evidence/i);
    expect(() => validateContribution({ ...candidate, claims: [{ ...candidate.claims[0], quote: "99% accuracy" }] }, input, "model")).toThrow(/quote/i);
  });
  it("rejects claims absent from the draft and product hype", () => {
    expect(() => validateContribution({ ...candidate, claims: [{ ...candidate.claims[0], sentence: "Something never written." }] }, input, "model")).toThrow(/claim/i);
    expect(() => validateContribution({ ...candidate, text: "Our product is guaranteed to fix this and resolve every issue in your evaluation workflow." }, input, "model")).toThrow(/promotion|unsupported promises/i);
  });
  it("abstains when there is no useful contribution", () => {
    const result = validateContribution({ decision: "abstain", reason: "The existing reply already explains the method." }, input, "model");
    expect(result.quality?.kind).toBe("abstain");
    expect(result.originalText).toContain("No reply recommended");
  });
  it("keeps abbreviations inside a complete evidence-backed sentence", () => {
    const text = "A local evaluation, e.g. hidden tests in a separate context, makes the evaluation reproducible.";
    const evidence = { ...input.evidence[0]!, contentMd: text };
    const draft = validateContribution({ ...candidate, text, claims: [{ sentence: text, documentId: evidence.documentId, quote: text }] }, { ...input, evidence: [evidence] }, "model");
    expect(draft.quality?.kind).toBe("draft");
  });
  it("keeps the sentence boundary after a terminal abbreviation", () => {
    const sentences = ["Collect the prompts, results, environment details, etc.", "Keep credentials outside the logs."];
    const text = sentences.join(" ");
    const evidence = { ...input.evidence[0]!, contentMd: text };
    expect(validateContribution({ ...candidate, text, claims: sentences.map(sentence => ({ sentence, documentId: evidence.documentId, quote: sentence })) }, { ...input, evidence: [evidence] }, "model").quality?.kind).toBe("draft");
  });
  it("rejects an unsupported factual clause added around a preserved cited sentence", () => {
    expect(() => validateContribution({ ...candidate, text: `This agent has certified SOC 2 controls and ${candidate.text}` }, input, "model")).toThrow(/complete factual statement/i);
  });
  it("does not mistake User or Runtime factual statements for imperative advice", () => {
    for (const text of ["User data is retained for 90 days and encrypted using a certified key manager.", "Runtime execution is certified for processing confidential customer data."]) {
      expect(() => validateContribution({ ...candidate, text, claims: [] }, input, "model")).toThrow(/factual statement/i);
    }
  });
  it.each([
    "Try the SOC 2-certified storage option to keep confidential evaluation data encrypted.",
    "Could you use the SOC 2-certified storage option to keep confidential evaluation data encrypted?",
  ])("requires evidence for facts embedded in advice or questions: %s", text => {
    expect(() => validateContribution({ ...candidate, text, claims: [] }, input, "model")).toThrow(/matching evidence claim/i);
  });
  it("does not accept a draft which duplicates a supplied existing reply", () => {
    const withReplies = { ...input, existingReplies: [candidate.text] };
    expect(() => validateContribution(candidate, withReplies, "model")).toThrow(/already|repeat/i);
  });
});
