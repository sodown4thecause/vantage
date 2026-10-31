import { describe, expect, it } from "vitest";

import { buildEvidencePacket } from "@/lib/seo-agent/evidence";
import { collectorPrompt, summarizerPrompt } from "@/lib/seo-agent/prompt";
import { profileContext } from "@/lib/seo-agent/suggestions";

const PROFILE = {
  ...profileContext({ productUrl: "https://acme.dev", competitors: ["https://rival.io"], topics: ["ci caching"] }),
  description: "Build cache for CI",
  targetCustomer: "platform engineers",
};

describe("collect → summarize contracts", () => {
  it("keeps collector prompt tool-only and summarizer prompt evidence-bound", () => {
    const collect = collectorPrompt(PROFILE);
    const summarize = summarizerPrompt(PROFILE);

    expect(collect).toMatch(/gather live SEO\/GEO evidence/i);
    expect(collect).not.toContain("suggest_follow_ups");
    expect(collect).toContain("Do not write the owner-facing answer");

    expect(summarize).toContain("evidence packet");
    expect(summarize).toContain("suggest_follow_ups");
    expect(summarize).toContain("Write the owner-facing answer only from the evidence packet");
  });

  it("builds a bounded evidence packet without planner prose", () => {
    const packet = buildEvidencePacket({
      question: "Which keywords should we target?",
      conversationContext: "user: earlier turn",
      profile: {
        productDomain: PROFILE.productDomain,
        productName: PROFILE.productName,
        competitor: PROFILE.competitor,
        topic: PROFILE.topic,
        description: PROFILE.description,
        targetCustomer: PROFILE.targetCustomer,
      },
      results: [{
        tool: "ranked_keywords",
        source: "live",
        value: [{
          keyword: "ci caching",
          searchVolume: 1200,
          cpc: null,
          difficulty: 12,
          intent: "informational",
          position: 4,
          url: "https://rival.io/ci",
        }],
      }],
      notices: ["sample notice"],
      pendingApprovals: [{ tool: "backlink_summary", input: { target: "rival.io" }, credits: 1 }],
    });

    expect(packet.question).toBe("Which keywords should we target?");
    expect(packet.entries).toHaveLength(1);
    expect(packet.entries[0]).toMatchObject({ tool: "ranked_keywords", source: "live" });
    expect(packet.notices).toEqual(["sample notice"]);
    expect(packet.pendingApprovals).toEqual([
      { tool: "backlink_summary", input: { target: "rival.io" }, credits: 1 },
    ]);
    expect(JSON.stringify(packet)).not.toContain("I will now call");
  });
});
