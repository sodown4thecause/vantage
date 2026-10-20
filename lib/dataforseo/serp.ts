import { FRESHNESS_SECONDS } from "@/lib/dataforseo/cache";
import { peekDataForSeo, runDataForSeo } from "@/lib/dataforseo/gate";
import { type DataForSeoCall, SEO_DEFAULTS, itemsOf, num, recordsOf, str } from "@/lib/dataforseo/shared";

export type SerpOrganicResult = { position: number; domain: string; title: string; url: string };

export type SerpSummary = {
  organic: SerpOrganicResult[];
  hasAiOverview: boolean;
  peopleAlsoAsk: string[];
};

type GateOptions = NonNullable<Parameters<typeof runDataForSeo>[1]>;

const SERP_PATH = "/v3/serp/google/organic/live/advanced";

/**
 * Organic rows need a string domain and url; a missing title becomes "". AI overview presence and the
 * "people also ask" questions are read from the other item types on the same SERP.
 */
export function trimSerp(result: unknown[]): SerpSummary {
  const rows = itemsOf(result);
  const organic = rows.flatMap((row) => {
    if (row.type !== "organic") return [];
    const domain = str(row.domain);
    const url = str(row.url);
    if (!domain || !url) return [];
    return [{ position: num(row.rank_absolute), domain, title: str(row.title) ?? "", url }];
  });
  const peopleAlsoAsk = rows
    .filter((row) => row.type === "people_also_ask")
    .flatMap((block) => recordsOf(block.items))
    .flatMap((question) => {
      const title = str(question.title);
      return title ? [title] : [];
    });
  return { organic, hasAiOverview: rows.some((row) => row.type === "ai_overview"), peopleAlsoAsk };
}

export function googleSerpTask(keyword: string): DataForSeoCall {
  return { endpoint: SERP_PATH, task: { keyword, ...SEO_DEFAULTS, depth: 10 }, estimateUsd: 0.01 };
}

export function fetchGoogleSerp(workspaceId: string, keyword: string, opts?: GateOptions) {
  const call = googleSerpTask(keyword);
  return runDataForSeo<unknown, SerpSummary>({
    workspaceId,
    endpoint: call.endpoint,
    task: call.task,
    freshnessSeconds: FRESHNESS_SECONDS.serp,
    estimateUsd: call.estimateUsd,
    trim: trimSerp,
  }, opts);
}

/** Cache-only read of the SERP for a keyword. Never spends. */
export function peekGoogleSerp(keyword: string) {
  const call = googleSerpTask(keyword);
  return peekDataForSeo<SerpSummary>(call.endpoint, call.task, FRESHNESS_SECONDS.serp);
}
