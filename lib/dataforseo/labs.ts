import { FRESHNESS_SECONDS } from "@/lib/dataforseo/cache";
import { peekDataForSeo, runDataForSeo } from "@/lib/dataforseo/gate";
import { type DataForSeoCall, SEO_DEFAULTS, isRecord, itemsOf, num, numOrNull, recordOf, str } from "@/lib/dataforseo/shared";

export type KeywordRow = {
  keyword: string;
  searchVolume: number;
  cpc: number | null;
  difficulty: number | null;
  intent: string | null;
};

export type RankedKeyword = KeywordRow & { position: number | null; url: string | null };

export type CompetitorDomain = { domain: string; avgPosition: number | null; intersections: number };

type GateOptions = NonNullable<Parameters<typeof runDataForSeo>[1]>;

const LABS = "/v3/dataforseo_labs/google";

/**
 * One keyword row. Rows from keyword_ideas carry their fields at the top level; rows from the overview, ranked and
 * intersection endpoints nest them under keyword_data. A row without a string keyword is dropped.
 */
function keywordRow(item: Record<string, unknown>): KeywordRow | null {
  const data = isRecord(item.keyword_data) ? item.keyword_data : item;
  const keyword = str(data.keyword) ?? str(item.keyword);
  if (!keyword) return null;
  const info = recordOf(data.keyword_info);
  const properties = recordOf(data.keyword_properties);
  const intent = recordOf(data.search_intent_info);
  return {
    keyword,
    searchVolume: num(info.search_volume),
    cpc: numOrNull(info.cpc),
    difficulty: numOrNull(properties.keyword_difficulty),
    intent: str(intent.main_intent),
  };
}

/** Where a domain ranks for a keyword: the absolute position and the URL that ranks. */
function placement(element: unknown): { position: number | null; url: string | null } {
  const serp = recordOf(element);
  return { position: numOrNull(serp.rank_absolute), url: str(serp.url) };
}

function keywordRows(result: unknown[]): KeywordRow[] {
  return itemsOf(result).flatMap((item) => {
    const row = keywordRow(item);
    return row ? [row] : [];
  });
}

export function trimKeywordIdeas(result: unknown[]): KeywordRow[] {
  return keywordRows(result);
}

export function trimKeywordOverview(result: unknown[]): KeywordRow[] {
  return keywordRows(result);
}

export function trimRankedKeywords(result: unknown[]): RankedKeyword[] {
  return itemsOf(result).flatMap((item) => {
    const row = keywordRow(item);
    if (!row) return [];
    return [{ ...row, ...placement(recordOf(item.ranked_serp_element).serp_item) }];
  });
}

export function trimCompetitorDomains(result: unknown[]): CompetitorDomain[] {
  return itemsOf(result).flatMap((item) => {
    const domain = str(item.domain);
    if (!domain) return [];
    return [{ domain, avgPosition: numOrNull(item.avg_position), intersections: num(item.intersections) }];
  });
}

/** Keywords the competitor (first domain) ranks for and the target does not. */
export function trimKeywordGap(result: unknown[]): RankedKeyword[] {
  return itemsOf(result).flatMap((item) => {
    const row = keywordRow(item);
    if (!row) return [];
    return [{ ...row, ...placement(item.first_domain_serp_element) }];
  });
}

export function keywordIdeasTask(keywords: string[], limit = 50): DataForSeoCall {
  return { endpoint: `${LABS}/keyword_ideas/live`, task: { keywords, ...SEO_DEFAULTS, limit }, estimateUsd: 0.05 };
}

export function keywordOverviewTask(keywords: string[]): DataForSeoCall {
  return { endpoint: `${LABS}/keyword_overview/live`, task: { keywords, ...SEO_DEFAULTS }, estimateUsd: 0.05 };
}

export function rankedKeywordsTask(target: string, limit = 100): DataForSeoCall {
  return {
    endpoint: `${LABS}/ranked_keywords/live`,
    task: { target, ...SEO_DEFAULTS, limit, order_by: ["keyword_data.keyword_info.search_volume,desc"] },
    estimateUsd: 0.05,
  };
}

export function competitorDomainsTask(target: string, limit = 20): DataForSeoCall {
  return { endpoint: `${LABS}/competitors_domain/live`, task: { target, ...SEO_DEFAULTS, limit }, estimateUsd: 0.05 };
}

/** Keywords `competitor` ranks for that `target` does not: the competitor is target1 and intersections is false. */
export function keywordGapTask(target: string, competitor: string, limit = 100): DataForSeoCall {
  return {
    endpoint: `${LABS}/domain_intersection/live`,
    task: { target1: competitor, target2: target, intersections: false, ...SEO_DEFAULTS, limit },
    estimateUsd: 0.05,
  };
}

const labsRequest = <T>(workspaceId: string, call: DataForSeoCall, trim: (result: unknown[]) => T) => ({
  workspaceId,
  endpoint: call.endpoint,
  task: call.task,
  freshnessSeconds: FRESHNESS_SECONDS.keywords,
  estimateUsd: call.estimateUsd,
  trim,
});

export function fetchKeywordIdeas(workspaceId: string, keywords: string[], limit = 50, opts?: GateOptions) {
  return runDataForSeo<unknown, KeywordRow[]>(labsRequest(workspaceId, keywordIdeasTask(keywords, limit), trimKeywordIdeas), opts);
}

export function fetchKeywordOverview(workspaceId: string, keywords: string[], opts?: GateOptions) {
  return runDataForSeo<unknown, KeywordRow[]>(labsRequest(workspaceId, keywordOverviewTask(keywords), trimKeywordOverview), opts);
}

export function fetchRankedKeywords(workspaceId: string, target: string, limit = 100, opts?: GateOptions) {
  return runDataForSeo<unknown, RankedKeyword[]>(labsRequest(workspaceId, rankedKeywordsTask(target, limit), trimRankedKeywords), opts);
}

export function fetchCompetitorDomains(workspaceId: string, target: string, limit = 20, opts?: GateOptions) {
  return runDataForSeo<unknown, CompetitorDomain[]>(labsRequest(workspaceId, competitorDomainsTask(target, limit), trimCompetitorDomains), opts);
}

export function fetchKeywordGap(workspaceId: string, target: string, competitor: string, limit = 100, opts?: GateOptions) {
  return runDataForSeo<unknown, RankedKeyword[]>(labsRequest(workspaceId, keywordGapTask(target, competitor, limit), trimKeywordGap), opts);
}

// Cache-only reads. Each takes the same arguments as its builder and never spends.
const peekLabs = <T>(call: DataForSeoCall) => peekDataForSeo<T>(call.endpoint, call.task, FRESHNESS_SECONDS.keywords);

export const peekKeywordIdeas = (keywords: string[], limit = 50) => peekLabs<KeywordRow[]>(keywordIdeasTask(keywords, limit));
export const peekKeywordOverview = (keywords: string[]) => peekLabs<KeywordRow[]>(keywordOverviewTask(keywords));
export const peekRankedKeywords = (target: string, limit = 100) => peekLabs<RankedKeyword[]>(rankedKeywordsTask(target, limit));
export const peekCompetitorDomains = (target: string, limit = 20) => peekLabs<CompetitorDomain[]>(competitorDomainsTask(target, limit));
export const peekKeywordGap = (target: string, competitor: string, limit = 100) =>
  peekLabs<RankedKeyword[]>(keywordGapTask(target, competitor, limit));
