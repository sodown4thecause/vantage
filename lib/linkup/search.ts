import type { CostContext } from "@/lib/costs/meter";
import { requiredEnv } from "@/lib/env/required";
import { fetchPublicText } from "@/lib/http/public-fetch";
import { runPaidCall } from "@/lib/providers/paid-call";

export type LinkupSearchHit = { url: string; title: string; snippet: string };

/** `fast` depth with `searchResults` output: $0.005 per call (docs.linkup.so search pricing, checked 23 Oct 2026). */
export const LINKUP_FAST_SEARCH_USD = 0.005;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function hasLinkupApiKey(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.LINKUP_API_KEY?.trim());
}

/** Linkup's `fromDate` (YYYY-MM-DD, UTC) for a lookback window. */
export function linkupFromDate(lookbackHours: number, now = Date.now()): string {
  return new Date(now - lookbackHours * 3_600_000).toISOString().slice(0, 10);
}

/**
 * Paid Linkup web search (`POST /v1/search`, depth `fast`, raw search results). Goes through
 * `runPaidCall`, so it needs paid-provider opt-in and a daily budget like every other paid call.
 */
export async function linkupSearch(query: string, opts: {
  maxResults: number; includeDomains?: string[]; fromDate?: string;
  context: CostContext; signal?: AbortSignal;
}): Promise<LinkupSearchHit[]> {
  opts.signal?.throwIfAborted();
  const key = requiredEnv("LINKUP_API_KEY").trim();
  const maxResults = Math.min(20, Math.max(1, Math.floor(opts.maxResults)));
  return runPaidCall({ context: opts.context, provider: "linkup", action: "search",
    estimateUsd: LINKUP_FAST_SEARCH_USD, signal: opts.signal }, async () => {
    const { response, text } = await fetchPublicText("https://api.linkup.so/v1/search", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, depth: "fast", outputType: "searchResults", maxResults,
        ...(opts.includeDomains?.length ? { includeDomains: opts.includeDomains } : {}),
        ...(opts.fromDate ? { fromDate: opts.fromDate } : {}) }),
      signal: opts.signal, cache: "no-store",
    }, 1_000_000, fetch, 30_000);
    if (!response.ok) throw new Error(`Linkup search failed (${response.status})`);
    let payload: unknown;
    try { payload = JSON.parse(text); } catch { throw new Error("Invalid Linkup search response"); }
    if (!isRecord(payload) || !Array.isArray(payload.results)) throw new Error("Invalid Linkup search response");
    opts.signal?.throwIfAborted();
    return { value: payload.results.filter(isRecord).flatMap(row => typeof row.url === "string" && row.url
      ? [{ url: row.url, title: typeof row.name === "string" ? row.name : "",
        snippet: typeof row.content === "string" ? row.content : "" }]
      : []) };
  });
}
