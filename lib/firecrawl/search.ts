import type { CostContext } from "@/lib/costs/meter";
import { fetchPublicText } from "@/lib/http/public-fetch";
import { runPaidCall } from "@/lib/providers/paid-call";

export type FirecrawlSearchHit = { url: string; title: string; snippet: string; date?: string };

/** Standard web search: 2 credits per 10 results (Firecrawl search API reference, checked 13 Oct 2026). */
const CREDITS_PER_TEN_RESULTS = 2;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function hasFirecrawlApiKey(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.FIRECRAWL_API_KEY?.trim());
}

/** Firecrawl's time filter for a lookback window. */
export function firecrawlTbs(lookbackHours: number): string {
  if (lookbackHours <= 24) return "qdr:d";
  if (lookbackHours <= 168) return "qdr:w";
  return "qdr:m";
}

/**
 * Paid Firecrawl web search (`POST /v2/search`). Goes through `runPaidCall`, so it needs
 * paid-provider opt-in, a daily budget and a positive `FIRECRAWL_CREDIT_USD`.
 * `includeDomains` and `excludeDomains` are mutually exclusive upstream.
 */
export async function firecrawlSearch(query: string, opts: {
  limit: number; tbs?: string; includeDomains?: string[]; excludeDomains?: string[];
  context: CostContext; signal?: AbortSignal;
}): Promise<FirecrawlSearchHit[]> {
  opts.signal?.throwIfAborted();
  const key = process.env.FIRECRAWL_API_KEY?.trim();
  if (!key) throw new Error("FIRECRAWL_API_KEY is not configured");
  const creditUsd = Number(process.env.FIRECRAWL_CREDIT_USD);
  if (!Number.isFinite(creditUsd) || creditUsd <= 0) throw new Error("FIRECRAWL_CREDIT_USD conversion must be configured and positive");
  const limit = Math.min(20, Math.max(1, Math.floor(opts.limit)));
  const domains = opts.includeDomains?.length ? { includeDomains: opts.includeDomains }
    : opts.excludeDomains?.length ? { excludeDomains: opts.excludeDomains } : {};
  const estimatedCredits = Math.ceil(limit / 10) * CREDITS_PER_TEN_RESULTS;
  return runPaidCall({ context: opts.context, provider: "firecrawl", action: "search", estimateUsd: estimatedCredits * creditUsd, signal: opts.signal }, async () => {
    const { response, text } = await fetchPublicText("https://api.firecrawl.dev/v2/search", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit, sources: ["web"], highlights: false, ...(opts.tbs ? { tbs: opts.tbs } : {}), ...domains }),
      signal: opts.signal, cache: "no-store",
    }, 1_000_000, fetch, 30_000);
    if (!response.ok) throw new Error(`Firecrawl search failed (${response.status})`);
    let payload: unknown;
    try { payload = JSON.parse(text); } catch { throw new Error("Invalid Firecrawl search response"); }
    if (!isRecord(payload) || payload.success !== true || !isRecord(payload.data) || !Array.isArray(payload.data.web)) {
      throw new Error("Invalid Firecrawl search response");
    }
    opts.signal?.throwIfAborted();
    const hits = payload.data.web.filter(isRecord).flatMap(row => {
      if (typeof row.url !== "string" || !row.url) return [];
      const date = typeof row.date === "string" ? row.date : undefined;
      return [{ url: row.url, title: typeof row.title === "string" ? row.title : "",
        snippet: typeof row.description === "string" ? row.description : "", ...(date ? { date } : {}) }];
    });
    const credits = payload.creditsUsed;
    return { value: hits, costUsd: typeof credits === "number" && Number.isFinite(credits) && credits >= 0 ? credits * creditUsd : undefined };
  });
}
