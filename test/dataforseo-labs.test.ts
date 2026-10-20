import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runDataForSeo: vi.fn(), peekDataForSeo: vi.fn() }));
vi.mock("@/lib/dataforseo/gate", () => ({
  runDataForSeo: mocks.runDataForSeo,
  peekDataForSeo: mocks.peekDataForSeo,
}));

import { FRESHNESS_SECONDS } from "@/lib/dataforseo/cache";
import {
  competitorDomainsTask,
  fetchCompetitorDomains,
  fetchKeywordGap,
  fetchKeywordIdeas,
  fetchKeywordOverview,
  fetchRankedKeywords,
  keywordGapTask,
  keywordIdeasTask,
  keywordOverviewTask,
  peekCompetitorDomains,
  peekKeywordGap,
  peekKeywordIdeas,
  peekKeywordOverview,
  peekRankedKeywords,
  rankedKeywordsTask,
  trimCompetitorDomains,
  trimKeywordGap,
  trimKeywordIdeas,
  trimKeywordOverview,
  trimRankedKeywords,
} from "@/lib/dataforseo/labs";

const OPTS = { signal: new AbortController().signal };

beforeEach(() => {
  mocks.runDataForSeo.mockReset().mockResolvedValue({ value: [], cached: false });
  mocks.peekDataForSeo.mockReset().mockResolvedValue(null);
});

describe("Labs task builders", () => {
  it("builds the keyword ideas call with a 50-row default", () => {
    expect(keywordIdeasTask(["crm software"])).toEqual({
      endpoint: "/v3/dataforseo_labs/google/keyword_ideas/live",
      task: { keywords: ["crm software"], location_code: 2840, language_code: "en", limit: 50 },
      estimateUsd: 0.05,
    });
  });

  it("honours an explicit keyword ideas limit", () => {
    expect(keywordIdeasTask(["crm"], 10).task).toMatchObject({ limit: 10 });
  });

  it("builds the keyword overview call without a limit", () => {
    expect(keywordOverviewTask(["crm", "erp"])).toEqual({
      endpoint: "/v3/dataforseo_labs/google/keyword_overview/live",
      task: { keywords: ["crm", "erp"], location_code: 2840, language_code: "en" },
      estimateUsd: 0.05,
    });
  });

  it("builds the ranked keywords call ordered by search volume, 100 rows by default", () => {
    expect(rankedKeywordsTask("example.com")).toEqual({
      endpoint: "/v3/dataforseo_labs/google/ranked_keywords/live",
      task: {
        target: "example.com",
        location_code: 2840,
        language_code: "en",
        limit: 100,
        order_by: ["keyword_data.keyword_info.search_volume,desc"],
      },
      estimateUsd: 0.05,
    });
  });

  it("builds the competitor domains call with a 20-row default", () => {
    expect(competitorDomainsTask("example.com")).toEqual({
      endpoint: "/v3/dataforseo_labs/google/competitors_domain/live",
      task: { target: "example.com", location_code: 2840, language_code: "en", limit: 20 },
      estimateUsd: 0.05,
    });
  });

  it("builds the keyword gap call with the competitor as target1 and intersections false", () => {
    expect(keywordGapTask("example.com", "rival.com")).toEqual({
      endpoint: "/v3/dataforseo_labs/google/domain_intersection/live",
      task: {
        target1: "rival.com",
        target2: "example.com",
        intersections: false,
        location_code: 2840,
        language_code: "en",
        limit: 100,
      },
      estimateUsd: 0.05,
    });
  });
});

describe("trimKeywordIdeas", () => {
  it("maps items to keyword rows and drops items without a string keyword", () => {
    const result = [{
      items: [
        {
          keyword: "crm software",
          keyword_info: { search_volume: 9900, cpc: 4.25, competition: 0.7 },
          keyword_properties: { keyword_difficulty: 61 },
          search_intent_info: { main_intent: "commercial" },
        },
        { keyword: 7, keyword_info: { search_volume: 1 } },
        "junk",
      ],
    }];
    expect(trimKeywordIdeas(result)).toEqual([
      { keyword: "crm software", searchVolume: 9900, cpc: 4.25, difficulty: 61, intent: "commercial" },
    ]);
  });

  it("zeroes a missing or wrong-typed search volume and nulls missing cpc, difficulty and intent", () => {
    const result = [{ items: [{ keyword: "bare", keyword_info: { search_volume: "lots", cpc: "x" } }] }];
    expect(trimKeywordIdeas(result)).toEqual([
      { keyword: "bare", searchVolume: 0, cpc: null, difficulty: null, intent: null },
    ]);
  });

  it("returns an empty list for an empty result or one without items", () => {
    expect(trimKeywordIdeas([])).toEqual([]);
    expect(trimKeywordIdeas([{ no_items: true }])).toEqual([]);
  });
});

describe("trimKeywordOverview", () => {
  it("reads the keyword row from keyword_data and accepts a top-level keyword", () => {
    const result = [{
      items: [
        {
          keyword_data: {
            keyword: "crm",
            keyword_info: { search_volume: 1000, cpc: 2.5 },
            keyword_properties: { keyword_difficulty: 40 },
            search_intent_info: { main_intent: "informational" },
          },
        },
        { keyword_data: { keyword: 42 } },
        { keyword: "fallback", keyword_info: { search_volume: 5 } },
      ],
    }];
    expect(trimKeywordOverview(result)).toEqual([
      { keyword: "crm", searchVolume: 1000, cpc: 2.5, difficulty: 40, intent: "informational" },
      { keyword: "fallback", searchVolume: 5, cpc: null, difficulty: null, intent: null },
    ]);
  });
});

describe("trimRankedKeywords", () => {
  it("adds the organic position and url from ranked_serp_element.serp_item", () => {
    const result = [{
      items: [
        {
          keyword_data: {
            keyword: "crm",
            keyword_info: { search_volume: 1000, cpc: 2 },
            keyword_properties: { keyword_difficulty: 30 },
            search_intent_info: { main_intent: "commercial" },
          },
          ranked_serp_element: { serp_item: { rank_absolute: 3, url: "https://example.com/crm" } },
        },
        {
          keyword_data: { keyword: "no serp" },
          ranked_serp_element: { serp_item: { rank_absolute: "3", url: 5 } },
        },
        { keyword_data: { keyword: 9 } },
      ],
    }];
    expect(trimRankedKeywords(result)).toEqual([
      { keyword: "crm", searchVolume: 1000, cpc: 2, difficulty: 30, intent: "commercial", position: 3, url: "https://example.com/crm" },
      { keyword: "no serp", searchVolume: 0, cpc: null, difficulty: null, intent: null, position: null, url: null },
    ]);
  });
});

describe("trimCompetitorDomains", () => {
  it("copies domain, average position and intersections, dropping items without a domain", () => {
    const result = [{
      items: [
        { domain: "rival.com", avg_position: 4.2, intersections: 120, full_domain_metrics: { organic: {} } },
        { domain: "bare.com", intersections: "x" },
        { avg_position: 3, intersections: 4 },
      ],
    }];
    expect(trimCompetitorDomains(result)).toEqual([
      { domain: "rival.com", avgPosition: 4.2, intersections: 120 },
      { domain: "bare.com", avgPosition: null, intersections: 0 },
    ]);
  });
});

describe("trimKeywordGap", () => {
  it("keeps the competitor's position and url from first_domain_serp_element", () => {
    const result = [{
      items: [
        {
          keyword_data: { keyword: "gap term", keyword_info: { search_volume: 300 } },
          first_domain_serp_element: { rank_absolute: 7, url: "https://rival.com/gap" },
          second_domain_serp_element: null,
        },
        { keyword_data: { keyword: 1 } },
      ],
    }];
    expect(trimKeywordGap(result)).toEqual([
      { keyword: "gap term", searchVolume: 300, cpc: null, difficulty: null, intent: null, position: 7, url: "https://rival.com/gap" },
    ]);
  });
});

describe("Labs fetch wrappers", () => {
  it("fetchKeywordIdeas passes the builder values and the keywords freshness through runDataForSeo", async () => {
    await fetchKeywordIdeas("ws-1", ["crm"], undefined, OPTS);
    expect(mocks.runDataForSeo).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        endpoint: "/v3/dataforseo_labs/google/keyword_ideas/live",
        task: { keywords: ["crm"], location_code: 2840, language_code: "en", limit: 50 },
        freshnessSeconds: FRESHNESS_SECONDS.keywords,
        estimateUsd: 0.05,
        trim: trimKeywordIdeas,
      }),
      OPTS,
    );
  });

  it("fetchKeywordOverview uses the keywords freshness", async () => {
    await fetchKeywordOverview("ws-1", ["crm"]);
    expect(mocks.runDataForSeo.mock.calls[0][0]).toMatchObject({
      endpoint: "/v3/dataforseo_labs/google/keyword_overview/live",
      freshnessSeconds: 2_592_000,
      trim: trimKeywordOverview,
    });
  });

  it("fetchRankedKeywords, fetchCompetitorDomains and fetchKeywordGap each use their builder and trim", async () => {
    await fetchRankedKeywords("ws-1", "example.com", 25);
    expect(mocks.runDataForSeo.mock.calls[0][0]).toMatchObject({
      endpoint: "/v3/dataforseo_labs/google/ranked_keywords/live",
      task: expect.objectContaining({ target: "example.com", limit: 25 }),
      trim: trimRankedKeywords,
    });

    await fetchCompetitorDomains("ws-1", "example.com");
    expect(mocks.runDataForSeo.mock.calls[1][0]).toMatchObject({
      endpoint: "/v3/dataforseo_labs/google/competitors_domain/live",
      trim: trimCompetitorDomains,
    });

    await fetchKeywordGap("ws-1", "example.com", "rival.com", undefined, OPTS);
    expect(mocks.runDataForSeo.mock.calls[2][0]).toMatchObject({
      endpoint: "/v3/dataforseo_labs/google/domain_intersection/live",
      task: expect.objectContaining({ target1: "rival.com", target2: "example.com", intersections: false }),
      freshnessSeconds: FRESHNESS_SECONDS.keywords,
      trim: trimKeywordGap,
    });
    expect(mocks.runDataForSeo.mock.calls[2][1]).toBe(OPTS);
  });
});

describe("Labs peek wrappers", () => {
  it("read the cache only, with the keywords freshness and the builder task", async () => {
    await peekKeywordIdeas(["crm"]);
    await peekKeywordOverview(["crm"]);
    await peekRankedKeywords("example.com");
    await peekCompetitorDomains("example.com");
    await peekKeywordGap("example.com", "rival.com");

    expect(mocks.peekDataForSeo.mock.calls).toEqual([
      ["/v3/dataforseo_labs/google/keyword_ideas/live", keywordIdeasTask(["crm"]).task, FRESHNESS_SECONDS.keywords],
      ["/v3/dataforseo_labs/google/keyword_overview/live", keywordOverviewTask(["crm"]).task, FRESHNESS_SECONDS.keywords],
      ["/v3/dataforseo_labs/google/ranked_keywords/live", rankedKeywordsTask("example.com").task, FRESHNESS_SECONDS.keywords],
      ["/v3/dataforseo_labs/google/competitors_domain/live", competitorDomainsTask("example.com").task, FRESHNESS_SECONDS.keywords],
      ["/v3/dataforseo_labs/google/domain_intersection/live", keywordGapTask("example.com", "rival.com").task, FRESHNESS_SECONDS.keywords],
    ]);
    expect(mocks.runDataForSeo).not.toHaveBeenCalled();
  });
});
