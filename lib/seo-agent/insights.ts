/**
 * Optional knowledge-insights boundary for the SEO/GEO collector.
 * A real Neon KB reader lands with #103/#112. Until then no tool is advertised and live DataForSEO answers still work.
 */

import { isPublicHttpUrl } from "@/lib/http/public-fetch";

export const MAX_INSIGHT_PASSAGES = 5;
export const INSIGHT_TEXT_LIMIT = 2_000;
export const INSIGHTS_UNAVAILABLE_NOTICE = "Knowledge insights are not available yet.";

export type InsightPassage = {
  id: string;
  sourceUrl: string;
  text: string;
  /** ISO date when the source was published, if known. */
  publishedAt: string | null;
  /** ISO date when the source was last updated, if known. */
  updatedAt: string | null;
  /** ISO date when this passage was retrieved. */
  retrievedAt: string;
  /** Honest limits the model and owner should know (for example private corpus excluded). */
  limitations: string[];
};

export type InsightSearchInput = {
  workspaceId: string;
  query: string;
  limit?: number;
  signal?: AbortSignal;
};

/** Workspace-scoped public-corpus reader. Implementations must not return private third-party data as shared evidence. */
export type InsightRetriever = {
  search(input: InsightSearchInput): Promise<InsightPassage[]>;
};

/**
 * Returns a wired retriever when one exists. This slice has no production reader, so the default is null —
 * callers must not advertise `search_insights` without a real instance.
 */
export function createInsightRetriever(_env: Record<string, string | undefined> = process.env): InsightRetriever | null {
  return null;
}

export function insightsAvailable(retriever?: InsightRetriever | null): boolean {
  return (retriever ?? createInsightRetriever()) !== null;
}

/** Bound and sanitize passages before they reach a card or the evidence packet. Non-public source URLs are dropped. */
export function normalizeInsightPassages(passages: InsightPassage[], limit = MAX_INSIGHT_PASSAGES): InsightPassage[] {
  const out: InsightPassage[] = [];
  for (const passage of passages) {
    if (out.length >= limit) break;
    if (typeof passage.id !== "string" || passage.id.trim() === "") continue;
    if (typeof passage.sourceUrl !== "string" || !isPublicHttpUrl(passage.sourceUrl.trim())) continue;
    if (typeof passage.text !== "string" || passage.text.trim() === "") continue;
    if (typeof passage.retrievedAt !== "string" || passage.retrievedAt.trim() === "") continue;
    out.push({
      id: passage.id.trim().slice(0, 120),
      sourceUrl: passage.sourceUrl.trim().slice(0, 2_000),
      text: passage.text.trim().slice(0, INSIGHT_TEXT_LIMIT),
      publishedAt: typeof passage.publishedAt === "string" ? passage.publishedAt : null,
      updatedAt: typeof passage.updatedAt === "string" ? passage.updatedAt : null,
      retrievedAt: passage.retrievedAt.trim(),
      limitations: Array.isArray(passage.limitations)
        ? passage.limitations.filter((item): item is string => typeof item === "string").slice(0, 8)
        : [],
    });
  }
  return out;
}
