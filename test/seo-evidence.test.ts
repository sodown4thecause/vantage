import { describe, expect, it } from "vitest";

import {
  EVIDENCE_ITEM_JSON_LIMIT,
  EVIDENCE_TOTAL_JSON_LIMIT,
  MODEL_CONTEXT_LIMIT,
  buildEvidencePacket,
} from "@/lib/seo-agent/evidence";

describe("buildEvidencePacket", () => {
  it("builds typed entries from filtered tool results and keeps notices and approvals", () => {
    const packet = buildEvidencePacket({
      question: "Which keywords does rival.io rank for?",
      conversationContext: "Earlier: we compared backlinks.",
      profile: { productDomain: "acme.dev", competitor: "rival.io", topic: "ci caching" },
      results: [
        {
          tool: "ranked_keywords",
          source: "live",
          value: Array.from({ length: 40 }, (_, i) => ({
            keyword: `k${i}`,
            searchVolume: i,
            cpc: null,
            difficulty: 1,
            intent: "informational",
            position: i + 1,
            url: `https://rival.io/${i}`,
            drop: true,
          })),
        },
        {
          tool: "mystery",
          source: "live",
          value: { dump: "nope" },
        },
      ],
      notices: ["SEO lookups are paused. Try again later."],
      pendingApprovals: [{ tool: "llm_response", input: { prompt: "best ci cache", engines: ["claude"] }, credits: 2 }],
    });

    expect(packet.question).toBe("Which keywords does rival.io rank for?");
    expect(packet.profile).toEqual({ productDomain: "acme.dev", competitor: "rival.io", topic: "ci caching" });
    expect(packet.pendingApprovals).toHaveLength(1);
    expect(packet.entries[0]).toMatchObject({
      tool: "ranked_keywords",
      source: "live",
      truncated: true,
    });
    const ranked = packet.entries[0]!.data as { rows: unknown[]; total: number };
    expect(ranked.total).toBe(40);
    expect(ranked.rows).toHaveLength(25);
    expect(ranked.rows[0]).not.toHaveProperty("drop");
    expect(packet.notices).toEqual(expect.arrayContaining([
      "SEO lookups are paused. Try again later.",
      "Some research output could not be included safely.",
    ]));
    expect(packet.entries.some((entry) => entry.tool === "mystery")).toBe(false);
  });

  it("bounds conversation context and serialized evidence size", () => {
    const packet = buildEvidencePacket({
      question: "q",
      conversationContext: "c".repeat(MODEL_CONTEXT_LIMIT + 2000),
      profile: null,
      results: [
        {
          tool: "google_serp",
          source: "cached",
          value: {
            organic: Array.from({ length: 25 }, (_, i) => ({
              position: i + 1,
              domain: `d${i}.com`,
              title: "title ".repeat(800),
              url: `https://d${i}.com/${"path/".repeat(200)}`,
            })),
            hasAiOverview: false,
            peopleAlsoAsk: Array.from({ length: 25 }, (_, i) => "question ".repeat(200) + i),
          },
        },
        {
          tool: "referring_domains",
          source: "live",
          value: Array.from({ length: 25 }, (_, i) => ({
            domain: `ref${i}.com`,
            rank: i,
            backlinks: 1,
            spamScore: 0,
            firstSeen: null,
          })),
        },
      ],
      notices: [],
      pendingApprovals: [],
    });

    expect(packet.conversationContext.length).toBeLessThanOrEqual(MODEL_CONTEXT_LIMIT);
    for (const entry of packet.entries) {
      expect(JSON.stringify(entry).length).toBeLessThanOrEqual(EVIDENCE_ITEM_JSON_LIMIT);
    }
    expect(JSON.stringify(packet.entries).length).toBeLessThanOrEqual(EVIDENCE_TOTAL_JSON_LIMIT);
  });

  it("marks an entry truncated when bounding cut its data, and complete data as not truncated", () => {
    const serp = (titleLength: number) => ({
      organic: Array.from({ length: 10 }, (_, i) => ({
        position: i + 1,
        domain: `d${i}.com`,
        title: "t".repeat(titleLength),
        url: `https://d${i}.com/`,
      })),
      hasAiOverview: false,
      peopleAlsoAsk: [],
    });
    const packet = buildEvidencePacket({
      question: "q",
      conversationContext: "",
      profile: null,
      // The data fits the model payload limit on its own, so the projection reports no truncation. The entry's
      // lookup input then takes some of the per-item room, which is what cuts the data down.
      results: [
        { tool: "google_serp", source: "live", value: serp(1_100), input: { note: "n".repeat(800) } },
        { tool: "google_serp", source: "live", value: serp(20) },
      ],
      notices: [],
      pendingApprovals: [],
    });

    const [large, small] = packet.entries;
    expect(JSON.stringify(large).length).toBeLessThanOrEqual(EVIDENCE_ITEM_JSON_LIMIT);
    expect(large!.truncated).toBe(true);
    expect(small!.truncated).toBe(false);
  });
});
