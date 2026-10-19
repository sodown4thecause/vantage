import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  peekRankedKeywords: vi.fn(),
  peekKeywordIdeas: vi.fn(),
  peekKeywordGap: vi.fn(),
  peekGoogleSerp: vi.fn(),
  peekAiKeywordVolume: vi.fn(),
  peekDataForSeo: vi.fn(),
}));

vi.mock("@/lib/dataforseo/labs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dataforseo/labs")>();
  return {
    ...actual,
    peekRankedKeywords: mocks.peekRankedKeywords,
    peekKeywordIdeas: mocks.peekKeywordIdeas,
    peekKeywordGap: mocks.peekKeywordGap,
  };
});

vi.mock("@/lib/dataforseo/serp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dataforseo/serp")>();
  return { ...actual, peekGoogleSerp: mocks.peekGoogleSerp };
});

vi.mock("@/lib/dataforseo/ai-optimization", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dataforseo/ai-optimization")>();
  return { ...actual, peekAiKeywordVolume: mocks.peekAiKeywordVolume };
});

vi.mock("@/lib/dataforseo/gate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dataforseo/gate")>();
  return { ...actual, peekDataForSeo: mocks.peekDataForSeo };
});

import { FRESHNESS_SECONDS } from "@/lib/dataforseo/cache";
import { referringDomainsTask } from "@/lib/dataforseo/backlinks";
import {
  type Chip,
  type ProfileContext,
  STARTER_TOOLS,
  costLabel,
  fallbackFollowUps,
  profileContext,
  starterChips,
  withCacheLabels,
} from "@/lib/seo-agent/suggestions";

const FULL_PROFILE = { productUrl: "https://www.contextfor.dev/pricing", competitors: ["rival.io"], topics: ["developer seo"] };
const FULL: ProfileContext = profileContext(FULL_PROFILE);
const EMPTY: ProfileContext = profileContext(null);

// 2026-10-19 is day 292 of the UTC year, so 292 % 3 === 1: the second template of each category.
const OCT_19 = new Date("2026-10-19T12:00:00Z");
const DAY_MS = 86_400_000;

const SEO_TEMPLATES = [
  "Which keywords does rival.io rank for that contextfor doesn't?",
  "Who links to rival.io but not to contextfor.dev?",
  "What are the top Google results for 'developer seo' right now?",
];
const GEO_TEMPLATES = [
  "Does ChatGPT mention contextfor when people ask about developer seo?",
  "Which sites do AI answers cite for 'developer seo'?",
  "How much AI search volume does 'developer seo' get?",
];
const CONTENT_TEMPLATES = [
  "What should our next blog post target to win 'developer seo' searches?",
  "Which 'developer seo' questions are people asking that we haven't covered?",
  "Plan a comparison post: contextfor vs rival.io",
];
const GENERIC = {
  seo: "What keywords should a new developer tool target first?",
  geo: "How do AI assistants decide which tools to recommend?",
  content: "What blog topics bring developer tools signups?",
};

const texts = (chips: Chip[]) => chips.map((chip) => chip.text);
const labels = (chips: Chip[]) => chips.map((chip) => chip.costLabel);

beforeEach(() => {
  vi.stubEnv("SEO_AGENT_GEO_ALWAYS_ASK", "true");
  mocks.peekRankedKeywords.mockResolvedValue(null);
  mocks.peekKeywordIdeas.mockResolvedValue(null);
  mocks.peekKeywordGap.mockResolvedValue(null);
  mocks.peekGoogleSerp.mockResolvedValue(null);
  mocks.peekAiKeywordVolume.mockResolvedValue(null);
  mocks.peekDataForSeo.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("profileContext", () => {
  it("derives the product domain, first-label name, first valid competitor domain and first topic", () => {
    expect(FULL).toEqual({
      productDomain: "contextfor.dev",
      productName: "contextfor",
      competitor: "rival.io",
      topic: "developer seo",
    });
  });

  it("returns all nulls for a missing profile", () => {
    expect(profileContext(null)).toEqual({ productDomain: null, productName: null, competitor: null, topic: null });
  });

  it("drops an unusable product URL and competitors that are not domains", () => {
    const ctx = profileContext({ productUrl: "not a url", competitors: ["Semrush"], topics: [] });
    expect(ctx).toEqual({ productDomain: null, productName: null, competitor: null, topic: null });
  });

  it("uses the first competitor that normalizes, lowercased and without www", () => {
    const ctx = profileContext({ productUrl: "https://contextfor.dev", competitors: ["Semrush", "https://www.Rival.io/"], topics: [] });
    expect(ctx.competitor).toBe("rival.io");
  });

  it("uses the first non-blank trimmed topic", () => {
    const ctx = profileContext({ productUrl: "https://contextfor.dev", competitors: [], topics: ["  ", " pricing "] });
    expect(ctx.topic).toBe("pricing");
  });
});

describe("starterChips", () => {
  it("returns exactly three chips in seo, geo, content order", () => {
    const chips = starterChips(FULL, OCT_19);
    expect(chips.map((chip) => chip.category)).toEqual(["seo", "geo", "content"]);
    expect(chips).toHaveLength(3);
  });

  it("substitutes profile values into the day's template", () => {
    const chips = starterChips(FULL, OCT_19);
    expect(texts(chips)).toEqual([SEO_TEMPLATES[1], GEO_TEMPLATES[1], CONTENT_TEMPLATES[1]]);
  });

  it("uses the generic copy for every category when the profile is empty", () => {
    expect(texts(starterChips(EMPTY, OCT_19))).toEqual([GENERIC.seo, GENERIC.geo, GENERIC.content]);
  });

  it("uses the generic copy for a category whose template needs a missing field", () => {
    const noCompetitor = profileContext({ productUrl: "https://contextfor.dev", competitors: [], topics: ["developer seo"] });
    // OCT_19 is index 1: SEO template 1 needs a competitor, content template 1 does not.
    const chips = starterChips(noCompetitor, OCT_19);
    expect(chips[0]!.text).toBe(GENERIC.seo);
    expect(chips[2]!.text).toBe(CONTENT_TEMPLATES[1]);
    // The day after is index 2: content template 2 needs a competitor, so content falls back to generic.
    const nextDay = starterChips(noCompetitor, new Date(OCT_19.getTime() + DAY_MS));
    expect(nextDay[2]!.text).toBe(GENERIC.content);
  });

  it("rotates the template for each category with the UTC day", () => {
    const days = [0, 1, 2].map((offset) => new Date(OCT_19.getTime() + offset * DAY_MS));
    const seoByDay = days.map((day) => starterChips(FULL, day)[0]!.text);
    const geoByDay = days.map((day) => starterChips(FULL, day)[1]!.text);
    const contentByDay = days.map((day) => starterChips(FULL, day)[2]!.text);
    expect(new Set(seoByDay)).toEqual(new Set(SEO_TEMPLATES));
    expect(new Set(geoByDay)).toEqual(new Set(GEO_TEMPLATES));
    expect(new Set(contentByDay)).toEqual(new Set(CONTENT_TEMPLATES));
  });

  it("keeps the same chips for any time within one UTC day", () => {
    const early = new Date("2026-10-19T00:01:00Z");
    const late = new Date("2026-10-19T23:59:00Z");
    expect(starterChips(FULL, early)).toEqual(starterChips(FULL, late));
  });

  it("labels each starter chip with its tool's cost", () => {
    const chips = starterChips(FULL, OCT_19);
    // SEO index 1 is referring_domains; GEO index 1 is llm_response (always asked); content index 1 is keyword_ideas.
    expect(labels(chips)).toEqual(["~1 credit", "Needs approval", "~1 credit"]);
  });

  it("labels GEO chips as two credits when the always-ask rule is off", () => {
    const chips = starterChips(FULL, OCT_19, false);
    expect(chips[1]!.costLabel).toBe("~2 credits");
  });

  it("reads the always-ask rule from the environment when no flag is passed", () => {
    vi.stubEnv("SEO_AGENT_GEO_ALWAYS_ASK", "false");
    expect(starterChips(FULL, OCT_19)[1]!.costLabel).toBe("~2 credits");
  });

  it("labels generic chips as free", () => {
    expect(labels(starterChips(EMPTY, OCT_19))).toEqual(["Free", "Free", "Free"]);
  });
});

describe("STARTER_TOOLS", () => {
  it("maps each profile template to the tool it runs and generic templates to none", () => {
    expect(STARTER_TOOLS).toEqual({
      "seo-0": "ranked_keywords",
      "seo-1": "referring_domains",
      "seo-2": "google_serp",
      "geo-0": "llm_response",
      "geo-1": "llm_response",
      "geo-2": "ai_keyword_volume",
      "content-0": "keyword_ideas",
      "content-1": "keyword_ideas",
      "content-2": "keyword_gap",
      "seo-generic": null,
      "geo-generic": null,
      "content-generic": null,
    });
  });
});

describe("fallbackFollowUps", () => {
  it("returns one non-empty seo, geo and content question for every intent", () => {
    const intents = ["concept", "out_of_scope", "backlinks", "keywords", "serp", "geo_visibility", "content", "all"] as const;
    for (const intent of intents) {
      for (const ctx of [FULL, EMPTY]) {
        const followUps = fallbackFollowUps(ctx, intent, OCT_19);
        expect(followUps.seo.trim().length).toBeGreaterThan(0);
        expect(followUps.geo.trim().length).toBeGreaterThan(0);
        expect(followUps.content.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("picks the template after the starter index, so the follow-ups differ from the starter chips", () => {
    const followUps = fallbackFollowUps(FULL, "keywords", OCT_19);
    expect(followUps).toEqual({ seo: SEO_TEMPLATES[2], geo: GEO_TEMPLATES[2], content: CONTENT_TEMPLATES[2] });
    const starters = texts(starterChips(FULL, OCT_19));
    expect(starters).not.toContain(followUps.seo);
    expect(starters).not.toContain(followUps.geo);
    expect(starters).not.toContain(followUps.content);
  });

  it("is deterministic for the same context, intent and day", () => {
    expect(fallbackFollowUps(FULL, "content", OCT_19)).toEqual(fallbackFollowUps(FULL, "content", OCT_19));
  });

  it("falls back to the generic copy for an empty profile", () => {
    expect(fallbackFollowUps(EMPTY, "all", OCT_19)).toEqual(GENERIC);
  });
});

describe("costLabel", () => {
  it("is Free when there is no tool", () => {
    expect(costLabel(null, false, true)).toBe("Free");
  });

  it("is Free when the call is cached, whatever the tool", () => {
    expect(costLabel("ranked_keywords", true, false)).toBe("Free");
    expect(costLabel("llm_response", true, true)).toBe("Free");
  });

  it("is Needs approval for llm_response while GEO asks", () => {
    expect(costLabel("llm_response", false, true)).toBe("Needs approval");
  });

  it("is about two credits for llm_response when GEO does not ask", () => {
    expect(costLabel("llm_response", false, false)).toBe("~2 credits");
  });

  it("is about two credits for backlink_gap", () => {
    expect(costLabel("backlink_gap", false, true)).toBe("~2 credits");
  });

  it("is about one credit for any other tool", () => {
    expect(costLabel("ranked_keywords", false, true)).toBe("~1 credit");
    expect(costLabel("google_serp", false, false)).toBe("~1 credit");
  });
});

describe("placeholders", () => {
  const profiles: { name: string; ctx: ProfileContext }[] = [
    { name: "empty", ctx: EMPTY },
    { name: "full", ctx: FULL },
    { name: "domain only", ctx: profileContext({ productUrl: "https://contextfor.dev", competitors: [], topics: [] }) },
    { name: "competitor only", ctx: profileContext({ productUrl: "not a url", competitors: ["rival.io"], topics: [] }) },
    { name: "topic only", ctx: profileContext({ productUrl: "not a url", competitors: [], topics: ["pricing"] }) },
    {
      name: "domain and competitor",
      ctx: profileContext({ productUrl: "https://contextfor.dev", competitors: ["rival.io"], topics: [] }),
    },
    {
      name: "domain and topic",
      ctx: profileContext({ productUrl: "https://contextfor.dev", competitors: [], topics: ["pricing"] }),
    },
    {
      name: "competitor and topic",
      ctx: profileContext({ productUrl: "not a url", competitors: ["rival.io"], topics: ["pricing"] }),
    },
  ];

  it.each(profiles)("never leaves an unfilled placeholder for the $name profile", ({ ctx }) => {
    for (let offset = 0; offset < 3; offset += 1) {
      const now = new Date(OCT_19.getTime() + offset * DAY_MS);
      for (const chip of starterChips(ctx, now)) {
        expect(chip.text).not.toMatch(/[{}]/);
      }
      const followUps = fallbackFollowUps(ctx, "all", now);
      for (const text of Object.values(followUps)) {
        expect(text).not.toMatch(/[{}]/);
      }
    }
  });
});

// Day indexes for the profile: DAY0 is index 0 (ranked, llm, keyword_ideas); DAY2 is index 2 (serp, ai volume, gap).
const DAY0 = new Date(OCT_19.getTime() - DAY_MS);
const DAY2 = new Date(OCT_19.getTime() + DAY_MS);

describe("withCacheLabels", () => {
  it("marks ranked-keywords and keyword-ideas chips Free when cached and probes the template's own input", async () => {
    mocks.peekRankedKeywords.mockResolvedValue([]);
    mocks.peekKeywordIdeas.mockResolvedValue([]);
    const chips = await withCacheLabels(starterChips(FULL, DAY0), FULL);
    expect(mocks.peekRankedKeywords).toHaveBeenCalledWith("rival.io");
    expect(mocks.peekKeywordIdeas).toHaveBeenCalledWith(["developer seo"]);
    expect(labels(chips)).toEqual(["Free", "Needs approval", "Free"]);
  });

  it("marks SERP, AI volume and keyword-gap chips Free when cached", async () => {
    mocks.peekGoogleSerp.mockResolvedValue({});
    mocks.peekAiKeywordVolume.mockResolvedValue([]);
    mocks.peekKeywordGap.mockResolvedValue([]);
    const chips = await withCacheLabels(starterChips(FULL, DAY2), FULL);
    expect(mocks.peekGoogleSerp).toHaveBeenCalledWith("developer seo");
    expect(mocks.peekAiKeywordVolume).toHaveBeenCalledWith(["developer seo"]);
    expect(mocks.peekKeywordGap).toHaveBeenCalledWith("contextfor.dev", "rival.io");
    expect(labels(chips)).toEqual(["Free", "Free", "Free"]);
  });

  it("probes the backlink referring-domains call for the competitor", async () => {
    mocks.peekDataForSeo.mockResolvedValue([]);
    const chips = await withCacheLabels(starterChips(FULL, OCT_19), FULL);
    const backlinks = referringDomainsTask("rival.io");
    expect(mocks.peekDataForSeo).toHaveBeenCalledWith(backlinks.endpoint, backlinks.task, FRESHNESS_SECONDS.backlinks);
    expect(chips[0]!.costLabel).toBe("Free");
  });

  it("never peeks llm_response, so GEO chips keep their label even when other calls are cached", async () => {
    mocks.peekDataForSeo.mockResolvedValue([{ engine: "chat_gpt" }]);
    const chips = await withCacheLabels(starterChips(FULL, OCT_19), FULL);
    expect(chips[1]!.costLabel).toBe("Needs approval");
    expect(mocks.peekDataForSeo).not.toHaveBeenCalledWith(expect.stringContaining("llm_responses"), expect.anything(), expect.anything());
  });

  it("keeps the default label on a cache miss", async () => {
    const chips = await withCacheLabels(starterChips(FULL, OCT_19), FULL);
    expect(labels(chips)).toEqual(["~1 credit", "Needs approval", "~1 credit"]);
  });

  it("keeps the default label when a peek throws", async () => {
    mocks.peekKeywordIdeas.mockRejectedValue(new Error("database unavailable"));
    mocks.peekDataForSeo.mockRejectedValue(new Error("database unavailable"));
    const chips = await withCacheLabels(starterChips(FULL, OCT_19), FULL);
    expect(labels(chips)).toEqual(["~1 credit", "Needs approval", "~1 credit"]);
  });

  it("leaves generic chips and unknown chips untouched", async () => {
    const generic = starterChips(EMPTY, OCT_19);
    const unknown: Chip[] = [{ category: "seo", text: "Something else entirely", costLabel: "~1 credit" }];
    expect(await withCacheLabels(generic, EMPTY)).toEqual(generic);
    expect(await withCacheLabels(unknown, FULL)).toEqual(unknown);
    expect(mocks.peekRankedKeywords).not.toHaveBeenCalled();
    expect(mocks.peekDataForSeo).not.toHaveBeenCalled();
  });
});
