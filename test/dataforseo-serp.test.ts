import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runDataForSeo: vi.fn(), peekDataForSeo: vi.fn() }));
vi.mock("@/lib/dataforseo/gate", () => ({
  runDataForSeo: mocks.runDataForSeo,
  peekDataForSeo: mocks.peekDataForSeo,
}));

import { FRESHNESS_SECONDS } from "@/lib/dataforseo/cache";
import { fetchGoogleSerp, googleSerpTask, peekGoogleSerp, trimSerp } from "@/lib/dataforseo/serp";

beforeEach(() => {
  mocks.runDataForSeo.mockReset().mockResolvedValue({ value: [], cached: false });
  mocks.peekDataForSeo.mockReset().mockResolvedValue(null);
});

describe("googleSerpTask", () => {
  it("builds the advanced organic SERP call at depth 10", () => {
    expect(googleSerpTask("crm software")).toEqual({
      endpoint: "/v3/serp/google/organic/live/advanced",
      task: { keyword: "crm software", location_code: 2840, language_code: "en", depth: 10 },
      estimateUsd: 0.01,
    });
  });
});

describe("trimSerp", () => {
  it("keeps organic rows and copies only typed fields", () => {
    const result = [{
      items: [
        { type: "organic", rank_absolute: 1, domain: "a.com", title: "A", url: "https://a.com/x", description: "ignored" },
        { type: "paid", rank_absolute: 2, domain: "ad.com", title: "Ad", url: "https://ad.com" },
        { type: "ai_overview", rank_absolute: 3 },
        {
          type: "people_also_ask",
          items: [
            { type: "people_also_ask_element", title: "What is CRM?" },
            { title: 5 },
            "junk",
          ],
        },
        { type: "organic", rank_absolute: "2", domain: "b.com", title: 9, url: "https://b.com" },
        { type: "organic", rank_absolute: 5, domain: 7, url: "https://c.com", title: "C" },
        { type: "organic", rank_absolute: 6, domain: "d.com", title: "D", url: 4 },
      ],
    }];
    expect(trimSerp(result)).toEqual({
      organic: [
        { position: 1, domain: "a.com", title: "A", url: "https://a.com/x" },
        { position: 0, domain: "b.com", title: "", url: "https://b.com" },
      ],
      hasAiOverview: true,
      peopleAlsoAsk: ["What is CRM?"],
    });
  });

  it("reports no AI overview and no questions when the SERP has neither", () => {
    expect(trimSerp([{ items: [{ type: "organic", rank_absolute: 1, domain: "a.com", title: "A", url: "https://a.com" }] }])).toMatchObject({
      hasAiOverview: false,
      peopleAlsoAsk: [],
    });
  });

  it("returns an empty SERP for an empty result", () => {
    expect(trimSerp([])).toEqual({ organic: [], hasAiOverview: false, peopleAlsoAsk: [] });
  });
});

describe("SERP fetch and peek", () => {
  it("fetchGoogleSerp passes the builder values and the serp freshness through runDataForSeo", async () => {
    const opts = { signal: new AbortController().signal };
    await fetchGoogleSerp("ws-1", "crm software", opts);
    expect(mocks.runDataForSeo).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        endpoint: "/v3/serp/google/organic/live/advanced",
        task: { keyword: "crm software", location_code: 2840, language_code: "en", depth: 10 },
        freshnessSeconds: FRESHNESS_SECONDS.serp,
        estimateUsd: 0.01,
        trim: trimSerp,
      }),
      opts,
    );
    expect(mocks.runDataForSeo.mock.calls[0][0].freshnessSeconds).toBe(604_800);
  });

  it("peekGoogleSerp reads the cache only, with the serp freshness", async () => {
    await peekGoogleSerp("crm software");
    expect(mocks.peekDataForSeo).toHaveBeenCalledExactlyOnceWith(
      "/v3/serp/google/organic/live/advanced",
      googleSerpTask("crm software").task,
      FRESHNESS_SECONDS.serp,
    );
    expect(mocks.runDataForSeo).not.toHaveBeenCalled();
  });
});
