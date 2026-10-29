import { describe, expect, it, vi } from "vitest";

import { filterToolEvidence, projectToolFields } from "@/lib/dataforseo/field-filter";
import { buildEvidencePacket } from "@/lib/seo-agent/evidence";
import {
  createInsightRetriever,
  insightsAvailable,
  normalizeInsightPassages,
  type InsightPassage,
  type InsightRetriever,
} from "@/lib/seo-agent/insights";
import { EndpointAttemptBudget, QuestionBudget } from "@/lib/seo-agent/budget";
import { toolsForIntent } from "@/lib/seo-agent/tools";
import { insightTools } from "@/lib/seo-agent/tools/insights";
import type { ToolContext } from "@/lib/seo-agent/tools/shared";

const WS = "11111111-1111-4111-8111-111111111111";

function ctx(retriever: InsightRetriever | null = null): ToolContext {
  return {
    workspaceId: WS,
    budget: new QuestionBudget(3, []),
    attempts: new EndpointAttemptBudget(),
    brandDomains: ["acme.dev"],
    cards: [],
    notices: [],
    insightRetriever: retriever,
  };
}

function passage(overrides: Partial<InsightPassage> = {}): InsightPassage {
  return {
    id: "p1",
    sourceUrl: "https://example.com/case-study",
    text: "Public GEO case study excerpt.",
    publishedAt: "2026-01-02T00:00:00.000Z",
    updatedAt: null,
    retrievedAt: "2026-10-25T00:00:00.000Z",
    limitations: ["public corpus only"],
    ...overrides,
  };
}

describe("insights boundary", () => {
  it("does not wire a production retriever in this slice", () => {
    expect(createInsightRetriever()).toBeNull();
    expect(insightsAvailable()).toBe(false);
  });

  it("does not advertise search_insights when no retriever is present", () => {
    expect(Object.keys(insightTools(ctx(null)))).toEqual([]);
    expect(Object.keys(toolsForIntent("keywords", ctx(null)))).not.toContain("search_insights");
  });

  it("registers search_insights alongside DataForSEO tools when a reader is injected", () => {
    const reader: InsightRetriever = { search: vi.fn(async () => [passage()]) };
    const tools = toolsForIntent("keywords", ctx(reader));
    expect(Object.keys(tools)).toContain("search_insights");
    expect(Object.keys(tools)).toContain("ranked_keywords");
  });

  it("normalizes passages, drops private-looking blanks, and caps at five", () => {
    const normalized = normalizeInsightPassages([
      passage({ id: "1", text: "one" }),
      passage({ id: "2", text: "two", sourceUrl: "https://example.com/2" }),
      passage({ id: "bad", sourceUrl: "", text: "missing url" }),
      passage({ id: "3", text: "three", sourceUrl: "https://example.com/3" }),
      passage({ id: "4", text: "four", sourceUrl: "https://example.com/4" }),
      passage({ id: "5", text: "five", sourceUrl: "https://example.com/5" }),
      passage({ id: "6", text: "six", sourceUrl: "https://example.com/6" }),
    ]);
    expect(normalized).toHaveLength(5);
    expect(normalized.map((item) => item.id)).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("drops passages whose source URL is not a public http(s) URL before they reach a card", () => {
    const normalized = normalizeInsightPassages([
      passage({ id: "ok" }),
      passage({ id: "loopback", sourceUrl: "http://127.0.0.1/secret" }),
      passage({ id: "script", sourceUrl: "javascript:alert(1)" }),
      passage({ id: "internal", sourceUrl: "https://db.internal/x" }),
    ]);
    expect(normalized.map((item) => item.id)).toEqual(["ok"]);
  });

  it("shows the owner only public sources when the retriever returns a private one", async () => {
    const reader: InsightRetriever = {
      search: vi.fn(async () => [passage(), passage({ id: "private", sourceUrl: "http://127.0.0.1/secret" })]),
    };
    const context = ctx(reader);
    const tool = insightTools(context, reader).search_insights!;
    const result = await tool.execute!({ query: "geo" }, { toolCallId: "t", messages: [] }) as { data?: { passages: Array<{ id: string }> } };
    expect(context.cards).toHaveLength(1);
    expect((context.cards[0]!.data as Array<{ id: string }>).map((item) => item.id)).toEqual(["p1"]);
    expect(JSON.stringify(result)).not.toContain("127.0.0.1");
  });

  it("projects public insight passages into the evidence packet and rejects non-public URLs", async () => {
    const reader: InsightRetriever = {
      search: vi.fn(async () => [
        passage(),
        passage({ id: "private", sourceUrl: "http://127.0.0.1/secret", text: "nope" }),
      ]),
    };
    const tools = insightTools(ctx(reader), reader);
    const result = await tools.search_insights!.execute!(
      { query: "geo case studies" },
      { toolCallId: "i1", messages: [], context: {} },
    );
    expect(result).toMatchObject({ source: "live" });
    const projected = projectToolFields("search_insights", {
      passages: [passage(), passage({ id: "x", sourceUrl: "javascript:alert(1)", text: "bad" })],
      total: 2,
    });
    expect("data" in projected).toBe(true);
    if ("data" in projected) {
      const data = projected.data as { passages: unknown[]; total: number };
      expect(data.passages).toHaveLength(1);
      expect(data.total).toBe(2);
    }
    expect(filterToolEvidence("search_insights", {
      passages: [passage({ publishedAt: null })],
      total: 1,
    })).toMatchObject({
      passages: [expect.objectContaining({ publishedAt: null, sourceUrl: "https://example.com/case-study" })],
      total: 1,
    });

    const packet = buildEvidencePacket({
      question: "Any GEO case studies?",
      conversationContext: "",
      profile: { productDomain: "acme.dev" },
      results: [{
        tool: "search_insights",
        source: "live",
        value: { passages: [passage()], total: 1 },
      }, {
        tool: "ranked_keywords",
        source: "live",
        value: [{
          keyword: "ci cache",
          searchVolume: 100,
          cpc: null,
          difficulty: 10,
          intent: "informational",
          position: 3,
          url: "https://rival.io/x",
        }],
      }],
      notices: [],
      pendingApprovals: [],
    });
    expect(packet.entries.map((entry) => entry.tool).sort()).toEqual(["ranked_keywords", "search_insights"]);
  });

  it("keeps live data tools available when the reader fails", async () => {
    const reader: InsightRetriever = {
      search: vi.fn(async () => { throw new Error("kb down"); }),
    };
    const toolCtx = ctx(reader);
    const tools = insightTools(toolCtx, reader);
    const result = await tools.search_insights!.execute!(
      { query: "notes" },
      { toolCallId: "i2", messages: [], context: {} },
    );
    expect(result).toEqual({ error: "failed" });
    expect(toolCtx.notices).toContain("Knowledge insights could not be loaded for this question.");
    expect(Object.keys(toolsForIntent("serp", toolCtx))).toContain("google_serp");
  });
});
