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
export type Chip = { category: "seo" | "geo" | "content"; text: string; costLabel: string };

type Category = Chip["category"];
const CATEGORIES: readonly Category[] = ["seo", "geo", "content"];
const ROTATION_SIZE = 3;
const DAY_MS = 86_400_000;

type Template = { id: string; text: string };

// Profile templates, three per category. Index N rotates in on days where dayOfYear % 3 === N.
const PROFILE_TEMPLATES: Record<Category, Template[]> = {
  seo: [
    { id: "seo-0", text: "Which keywords does {competitor} rank for that {productName} doesn't?" },
    { id: "seo-1", text: "Who links to {competitor} but not to {productDomain}?" },
    { id: "seo-2", text: "What are the top Google results for '{topic}' right now?" },
  ],
  geo: [
    { id: "geo-0", text: "Does ChatGPT mention {productName} when people ask about {topic}?" },
    { id: "geo-1", text: "Which sites do AI answers cite for '{topic}'?" },
    { id: "geo-2", text: "How much AI search volume does '{topic}' get?" },
  ],
  content: [
    { id: "content-0", text: "What should our next blog post target to win '{topic}' searches?" },
    { id: "content-1", text: "Which '{topic}' questions are people asking that we haven't covered?" },
    { id: "content-2", text: "Plan a comparison post: {productName} vs {competitor}" },
  ],
};

// Generic templates, one per category, used when a profile template needs a field the profile does not have.
const GENERIC_TEMPLATES: Record<Category, Template> = {
  seo: { id: "seo-generic", text: "What keywords should a new developer tool target first?" },
  geo: { id: "geo-generic", text: "How do AI assistants decide which tools to recommend?" },
  content: { id: "content-generic", text: "What blog topics bring developer tools signups?" },
};

/** Template id to the data tool its chip would run. Generic templates run no tool. */
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
  "seo-generic": null,
  "geo-generic": null,
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
  if (!tool || cached) return "Free";
  if (tool === "llm_response") return geoAsk ? "Needs approval" : "~2 credits";
  if (tool === "backlink_gap") return "~2 credits";
  return "~1 credit";
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
  return { text: GENERIC_TEMPLATES[category].text, tool: null };
}

/** Three starter chips in seo, geo, content order. Cost labels are the uncached default; see withCacheLabels. */
export function starterChips(ctx: ProfileContext, now: Date = new Date(), geoAsk: boolean = geoAlwaysAsk()): Chip[] {
  const index = utcDayOfYear(now) % ROTATION_SIZE;
  return CATEGORIES.map((category) => {
    const { text, tool } = pick(category, index, ctx);
    return { category, text, costLabel: costLabel(tool, false, geoAsk) };
  });
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
        return hit ? { ...chip, costLabel: "Free" } : chip;
      } catch {
        return chip;
      }
    }),
  );
}
