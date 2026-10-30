/**
 * Research traffic must use synchronous DataForSEO live paths only.
 * Account-balance and model-discovery GETs stay outside this allowlist.
 */

/** Exact endpoint strings currently used by research task builders. */
export const LIVE_RESEARCH_ENDPOINTS = [
  "/v3/backlinks/summary/live",
  "/v3/backlinks/referring_domains/live",
  "/v3/backlinks/anchors/live",
  "/v3/dataforseo_labs/google/keyword_ideas/live",
  "/v3/dataforseo_labs/google/keyword_overview/live",
  "/v3/dataforseo_labs/google/ranked_keywords/live",
  "/v3/dataforseo_labs/google/competitors_domain/live",
  "/v3/dataforseo_labs/google/domain_intersection/live",
  "/v3/serp/google/organic/live/advanced",
  "/v3/ai_optimization/chat_gpt/llm_responses/live",
  "/v3/ai_optimization/claude/llm_responses/live",
  "/v3/ai_optimization/gemini/llm_responses/live",
  "/v3/ai_optimization/perplexity/llm_responses/live",
  "/v3/ai_optimization/ai_keyword_data/keywords_search_volume/live",
] as const;

const ALLOWED = new Set<string>(LIVE_RESEARCH_ENDPOINTS);

/**
 * Exact matching deliberately rejects URLs, normalization tricks and task paths.
 * New endpoints need an explicit allowlist entry, not just a `live` substring.
 */
export function isLiveResearchEndpoint(endpoint: string): boolean {
  return ALLOWED.has(endpoint);
}

/** Throws when a research gate path is not an allowlisted live endpoint. */
export function assertLiveResearchEndpoint(endpoint: string): void {
  if (isLiveResearchEndpoint(endpoint)) return;
  // An invalid argument, not an upstream failure.
  throw new RangeError("DataForSEO research requires an allowlisted live endpoint.");
}
