import { referringDomainsTask, normalizeTarget } from "@/lib/dataforseo/backlinks";
import { peekAiKeywordVolume } from "@/lib/dataforseo/ai-optimization";
import { FRESHNESS_SECONDS } from "@/lib/dataforseo/cache";
import { peekDataForSeo } from "@/lib/dataforseo/gate";
import { peekKeywordGap, peekKeywordIdeas, peekRankedKeywords } from "@/lib/dataforseo/labs";
import { peekGoogleSerp } from "@/lib/dataforseo/serp";
import type { Intent } from "@/lib/seo-agent/classify";
import type { FollowUps } from "@/lib/seo-agent/conversations";
import { geoAlwaysAsk } from "@/lib/seo-agent/budget";

/*
 * Starter chips (shown before the owner types) and fallback follow-ups (used when the executor does not record its own).
 * Pure except withCacheLabels, which only reads the DataForSEO cache and never spends.
 */

export type ProfileContext = { productDomain: string | null; productName: string | null; competitor: string | null; topic: string | null };
export type Chip = {
  category: "seo" | "geo" | "content";
  text: string;
  costLabel: string;
  /** Exactly one chip in a journey set is recommended. */
  recommended?: boolean;
  /** Short plain-language reason shown with the recommended chip. */
  reason?: string;
};

export type JourneyFocus = "seo" | "geo";
export type JourneyContext = {
  profile: ProfileContext;
  focus?: JourneyFocus;
  /** Tools used in the latest answer, when known. */
  latestTools?: string[];
};

type Category = Chip["category"];
const CATEGORIES: readonly Category[] = ["seo", "geo", "content"];
const ROTATION_SIZE = 3;
const DAY_MS = 86_400_000;

type Template = { id: string; text: string };

// Profile templates, three per category. Index N rotates in on days where dayOfYear % 3 === N.
const PROFILE_TEMPLATES: Record<Category, Template[]> = {
  seo: [
    { id: "seo-0", text: "Which search phrases does {competitor} win that {productName} does not?" },
    { id: "seo-1", text: "Which sites recommend {competitor} but not {productDomain}?" },
    { id: "seo-2", text: "Who appears on Google for '{topic}' right now?" },
  ],
  geo: [
    { id: "geo-0", text: "Do AI assistants mention {productName} when people ask about {topic}?" },
    { id: "geo-1", text: "Which websites do AI answers recommend for '{topic}'?" },
    { id: "geo-2", text: "How often do people ask AI tools about '{topic}'?" },
  ],
  content: [
    { id: "content-0", text: "What should we research next to compete on '{topic}'?" },
    { id: "content-1", text: "Which '{topic}' questions still need a clear answer from us?" },
    { id: "content-2", text: "What would a fair {productName} vs {competitor} comparison cover?" },
  ],
};

// Generic templates, one per category, used when a profile template needs a field the profile does not have.
const GENERIC_TEMPLATES: Record<Category, Template> = {
  seo: { id: "seo-generic", text: "Who appears on Google for developer-tool searches?" },
  geo: { id: "geo-generic", text: "Do AI assistants mention tools like ours?" },
  content: { id: "content-generic", text: "What research would shape our next comparison brief?" },
};

/**
 * Template id to the data tool its chip would run. The generic SEO and GEO chips ask for Google results and AI answers,
 * so they carry those tools (and an estimate, not "Free"); only the generic research chip runs no tool.
 */
export const STARTER_TOOLS: Readonly<Record<string, string | null>> = {
  "seo-0": "ranked_keywords",
  "seo-1": "backlink_gap",
  "seo-2": "google_serp",
  "geo-0": "llm_response",
  "geo-1": "llm_response",
  "geo-2": "ai_keyword_volume",
  "content-0": "keyword_ideas",
  "content-1": "keyword_ideas",
  "content-2": "keyword_gap",
  "seo-generic": "google_serp",
  "geo-generic": "llm_response",
  "content-generic": null,
};

/** The first non-blank topic, trimmed; null when none. */
function firstTopic(topics: string[]): string | null {
  for (const topic of topics) {
    const trimmed = topic.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/** The first competitor that reduces to a bare domain; names like "Semrush" are skipped. */
function firstCompetitorDomain(competitors: string[]): string | null {
  for (const competitor of competitors) {
    const domain = normalizeTarget(competitor);
    if (domain) return domain;
  }
  return null;
}

export function profileContext(profile: { productUrl: string; competitors: string[]; topics: string[] } | null): ProfileContext {
  const productDomain = profile ? normalizeTarget(profile.productUrl) : null;
  return {
    productDomain,
    productName: productDomain ? productDomain.split(".")[0]! : null,
    competitor: profile ? firstCompetitorDomain(profile.competitors) : null,
    topic: profile ? firstTopic(profile.topics) : null,
  };
}

/** Day of the year in UTC, 1 for January 1st. */
function utcDayOfYear(now: Date): number {
  const year = now.getUTCFullYear();
  const start = Date.UTC(year, 0, 0);
  const today = Date.UTC(year, now.getUTCMonth(), now.getUTCDate());
  return Math.round((today - start) / DAY_MS);
}

export function costLabel(tool: string | null, cached: boolean, geoAsk: boolean): string {
  if (!tool) return "Free";
  if (cached) return "Free (cached)";
  if (tool === "llm_response") return geoAsk ? "Needs approval" : "Est. ~2 credits";
  if (tool === "backlink_gap") return "Est. ~2 credits";
  return "Est. ~1 credit";
}

type Rendered = { text: string; tool: string | null };

/** Fills a template's placeholders from the context; null when a field the template needs is missing. */
function fill(template: string, ctx: ProfileContext): string | null {
  let missing = false;
  const text = template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = ctx[key as keyof ProfileContext];
    if (!value) {
      missing = true;
      return "";
    }
    return value;
  });
  return missing ? null : text;
}

/** The profile template at `index` for a category, or the category's generic template when it cannot be filled. */
function pick(category: Category, index: number, ctx: ProfileContext): Rendered {
  const template = PROFILE_TEMPLATES[category][index]!;
  const text = fill(template.text, ctx);
  if (text !== null) return { text, tool: STARTER_TOOLS[template.id] ?? null };
  const generic = GENERIC_TEMPLATES[category];
  return { text: generic.text, tool: STARTER_TOOLS[generic.id] ?? null };
}

/** Three starter chips in seo, geo, content order. Cost labels are the uncached default; see withCacheLabels. */
export function starterChips(
  ctx: ProfileContext,
  now: Date = new Date(),
  geoAsk: boolean = geoAlwaysAsk(),
  focus: JourneyFocus = "seo",
): Chip[] {
  const index = utcDayOfYear(now) % ROTATION_SIZE;
  const chips = CATEGORIES.map((category) => {
    const { text, tool } = pick(category, index, ctx);
    return { category, text, costLabel: costLabel(tool, false, geoAsk) };
  });
  return annotateJourney(chips, { profile: ctx, focus });
}

/**
 * One follow-up per category from the same templates, one step past the starter rotation so they differ from the
 * starter chips where the profile allows. The intent does not change the pick today.
 */
export function fallbackFollowUps(ctx: ProfileContext, _intent: Intent, now: Date = new Date()): FollowUps {
  const index = (utcDayOfYear(now) + 1) % ROTATION_SIZE;
  return {
    seo: pick("seo", index, ctx).text,
    geo: pick("geo", index, ctx).text,
    content: pick("content", index, ctx).text,
  };
}

/** Maps each text this context can render to the tool behind it, so chips can be matched back to their template. */
function toolsByText(ctx: ProfileContext): Map<string, string | null> {
  const tools = new Map<string, string | null>();
  for (const category of CATEGORIES) {
    for (let index = 0; index < ROTATION_SIZE; index += 1) {
      const { text, tool } = pick(category, index, ctx);
      tools.set(text, tool);
    }
  }
  return tools;
}

/**
 * A cache-only probe with the same input the tool would use, or null when the tool cannot be probed. llm_response is
 * never probed: the agent picks the engine, prompt and model at run time, so no starter chip can name its cache entry.
 */
function probeFor(tool: string, ctx: ProfileContext): (() => Promise<unknown>) | null {
  const { competitor, productDomain, topic } = ctx;
  switch (tool) {
    case "ranked_keywords":
      return competitor ? () => peekRankedKeywords(competitor) : null;
    case "referring_domains": {
      if (!competitor) return null;
      const call = referringDomainsTask(competitor);
      return () => peekDataForSeo(call.endpoint, call.task, FRESHNESS_SECONDS.backlinks);
    }
    case "backlink_gap": {
      // The gap reads both sides' referring-domains calls, so the chip is free only when both are cached.
      if (!productDomain || !competitor) return null;
      const own = referringDomainsTask(productDomain);
      const rival = referringDomainsTask(competitor);
      return async () => {
        const [ownHit, rivalHit] = await Promise.all([
          peekDataForSeo(own.endpoint, own.task, FRESHNESS_SECONDS.backlinks),
          peekDataForSeo(rival.endpoint, rival.task, FRESHNESS_SECONDS.backlinks),
        ]);
        return ownHit !== null && rivalHit !== null ? { ownHit, rivalHit } : null;
      };
    }
    case "google_serp":
      return topic ? () => peekGoogleSerp(topic) : null;
    case "keyword_ideas":
      return topic ? () => peekKeywordIdeas([topic]) : null;
    case "ai_keyword_volume":
      return topic ? () => peekAiKeywordVolume([topic]) : null;
    case "keyword_gap":
      return productDomain && competitor ? () => peekKeywordGap(productDomain, competitor) : null;
    default:
      return null;
  }
}

/**
 * Marks a chip "Free" when the call its template runs is already cached. Any peek error leaves the chip as it was.
 * Never spends: every peek reads the cache only.
 */
export async function withCacheLabels(chips: Chip[], ctx: ProfileContext): Promise<Chip[]> {
  const tools = toolsByText(ctx);
  return Promise.all(
    chips.map(async (chip) => {
      const tool = tools.get(chip.text) ?? null;
      const probe = tool ? probeFor(tool, ctx) : null;
      if (!probe) return chip;
      try {
        const hit = await probe();
        return hit ? { ...chip, costLabel: costLabel(tool, true, false) } : chip;
      } catch {
        return chip;
      }
    }),
  );
}


/** Prefer GEO when the lane is GEO; otherwise react to the latest findings, and start with SEO when there are none. */
export function recommendCategory(input: JourneyContext): Category {
  if (input.focus === "geo") return "geo";
  const tools = input.latestTools ?? [];
  if (tools.some((tool) => tool === "llm_response" || tool === "ai_keyword_volume")) return "seo";
  if (tools.some((tool) => tool === "ranked_keywords" || tool === "google_serp" || tool === "keyword_ideas")) return "geo";
  if (tools.some((tool) => tool === "backlink_gap" || tool === "referring_domains")) return "content";
  return "seo";
}

export function recommendationReason(category: Category, input: JourneyContext): string {
  const { productName, competitor, topic, productDomain } = input.profile;
  if (input.focus === "geo" && category === "geo") {
    return "You are in GEO research — start with whether AI answers mention you.";
  }
  if (category === "seo") {
    if (competitor && productName) return `Uses ${competitor} to find search gaps versus ${productName}.`;
    if (topic) return `Shows who currently appears on Google for ${topic}.`;
    if (productDomain) return `Grounds the next step in ${productDomain} without needing a full profile.`;
    return "A simple Google visibility check — no profile setup required.";
  }
  if (category === "geo") {
    if (productName && topic) return `Checks whether assistants mention ${productName} for ${topic}.`;
    if (topic) return `Shows which sites AI answers recommend for ${topic}.`;
    return "Checks whether AI assistants mention tools like yours.";
  }
  if (competitor && productName) return `Turns rival and product context into a fair comparison brief.`;
  if (topic) return `Builds the next research step around ${topic}.`;
  return "Shapes a comparison brief from general developer-tool research.";
}

/** Mark exactly one chip recommended with a reason. Older chip arrays without metadata stay compatible. */
export function annotateJourney(chips: Chip[], input: JourneyContext): Chip[] {
  if (chips.length === 0) return chips;
  const recommended = recommendCategory(input);
  const hasCategory = chips.some((chip) => chip.category === recommended);
  const pick = hasCategory ? recommended : chips[0]!.category;
  return chips.map((chip) => {
    if (chip.category !== pick) {
      const { recommended: _r, reason: _reason, ...rest } = chip;
      return rest;
    }
    return {
      ...chip,
      recommended: true,
      reason: recommendationReason(pick, input),
    };
  });
}
