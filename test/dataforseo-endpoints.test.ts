import { describe, expect, it } from "vitest";

import {
  anchorsTask,
  referringDomainsTask,
  summaryTask,
} from "@/lib/dataforseo/backlinks";
import {
  aiKeywordVolumeTask,
  llmResponseTask,
  type LlmEngine,
} from "@/lib/dataforseo/ai-optimization";
import {
  assertLiveResearchEndpoint,
  isLiveResearchEndpoint,
  LIVE_RESEARCH_ENDPOINTS,
} from "@/lib/dataforseo/endpoints";
import {
  competitorDomainsTask,
  keywordGapTask,
  keywordIdeasTask,
  keywordOverviewTask,
  rankedKeywordsTask,
} from "@/lib/dataforseo/labs";
import { googleSerpTask } from "@/lib/dataforseo/serp";

const ENGINES = ["chat_gpt", "claude", "gemini", "perplexity"] as const satisfies readonly LlmEngine[];

describe("live research endpoints", () => {
  it("accepts every current research task builder path", () => {
    const builders = [
      summaryTask("example.com").endpoint,
      referringDomainsTask("example.com").endpoint,
      anchorsTask("example.com").endpoint,
      keywordIdeasTask(["crm"]).endpoint,
      keywordOverviewTask(["crm"]).endpoint,
      rankedKeywordsTask("example.com").endpoint,
      competitorDomainsTask("example.com").endpoint,
      keywordGapTask("example.com", "rival.io").endpoint,
      googleSerpTask("vector database").endpoint,
      aiKeywordVolumeTask(["vector database"]).endpoint,
      ...ENGINES.map((engine) => llmResponseTask(engine, "best vector database", "model-x").endpoint),
    ];

    expect(new Set(builders)).toEqual(new Set(LIVE_RESEARCH_ENDPOINTS));
    for (const endpoint of LIVE_RESEARCH_ENDPOINTS) {
      expect(endpoint).toMatch(/(^|\/)live(\/|$)/);
      expect(endpoint.startsWith("/v3/")).toBe(true);
      expect(endpoint.includes("?") || endpoint.includes("#")).toBe(false);
    }
    for (const endpoint of builders) {
      expect(isLiveResearchEndpoint(endpoint)).toBe(true);
      expect(() => assertLiveResearchEndpoint(endpoint)).not.toThrow();
    }
  });

  it.each([
    "/v3/serp/google/organic/task_post",
    "/v3/serp/google/organic/task_get/advanced/abc",
    "/v3/backlinks/summary/not_live",
    "/v3/backlinks/unknown/live",
    "/v3/backlinks/summary/live/task_post",
    "/v3/backlinks/summary/live?mode=standard",
    "/v3/backlinks/summary/live#fragment",
    "/v3/backlinks/summary/%6cive",
    "/v3/backlinks/summary/live/../task_post",
    "/v3/backlinks/summary/./live",
    "/v3\\backlinks\\summary\\live",
    " /v3/backlinks/summary/live",
    "/v3/backlinks/summary/live\n",
    "/v3/backlinks/summary/LIVE",
    "/v3/appendix/user_data",
    "/v3/ai_optimization/chat_gpt/llm_responses/models",
    "https://api.dataforseo.com/v3/backlinks/summary/live",
    "/v3/on_page/instant_pages/live",
    "/v3/backlinks/summary/live/",
    "/v3//backlinks/summary/live",
    "v3/backlinks/summary/live",
  ])("rejects %s", (endpoint) => {
    expect(isLiveResearchEndpoint(endpoint)).toBe(false);
    expect(() => assertLiveResearchEndpoint(endpoint)).toThrow(
      "DataForSEO research requires an allowlisted live endpoint.",
    );
  });
});
