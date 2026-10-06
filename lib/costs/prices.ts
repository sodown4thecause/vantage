import { and, desc, eq, lte } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { providerPrice } from "@/lib/db/schema";

export type PriceSeed = {
  provider: string;
  action: string;
  unitCostUsd: number;
  unit: string;
  notes: string;
};

/**
 * Hard-coded fallback and seed values (docs/slices/README.md section 4, checked 6 Oct 2026).
 * A missing table or row must never break a run, so lookups fall back to this list.
 * Re-check against the provider pricing pages before quoting publicly.
 */
export const DEFAULT_PRICES: PriceSeed[] = [
  { provider: "tinyfish", action: "agent_step", unitCostUsd: 0.016, unit: "step", notes: "TinyFish Agent per step. Source: competitor review 2026-10-06; pricing page URL unverified; checked 2026-10-06" },
  { provider: "tinyfish", action: "search", unitCostUsd: 0, unit: "request", notes: "TinyFish Search free. Source: competitor review 2026-10-06; pricing page URL unverified; checked 2026-10-06" },
  { provider: "tinyfish", action: "fetch", unitCostUsd: 0, unit: "request", notes: "TinyFish Fetch free. Source: competitor review 2026-10-06; pricing page URL unverified; checked 2026-10-06" },
  { provider: "scavio", action: "reddit_search", unitCostUsd: 0.004, unit: "request", notes: "Scavio Reddit search ~ $0.004/request (approx). Source: competitor review 2026-10-06; pricing page URL unverified; checked 2026-10-06" },
  { provider: "scavio", action: "x_search", unitCostUsd: 0.004, unit: "request", notes: "UNVERIFIED ASSUMPTION: set equal to Scavio Reddit (~ $0.004); no source found, confirm with Scavio pricing before relying on it" },
  { provider: "scavio", action: "youtube_comments", unitCostUsd: 0.004, unit: "request", notes: "UNVERIFIED ASSUMPTION: set equal to Scavio Reddit (~ $0.004); no source found, confirm with Scavio pricing before relying on it" },
  { provider: "grok", action: "x_search_post", unitCostUsd: 0.005, unit: "post", notes: "xAI x_search per-post fee $0.005 (82% of a 25-post scan ~ $0.15), plus model call. Source: competitor review 2026-10-06; see https://docs.x.ai (exact page unverified); checked 2026-10-06" },
  { provider: "grok", action: "score_post", unitCostUsd: 0.0005, unit: "post", notes: "AI scoring with grok-4.3 ~ $0.0005/post. Source: competitor review 2026-10-06; see https://docs.x.ai (exact page unverified); checked 2026-10-06" },
  { provider: "scrapecreators", action: "request", unitCostUsd: 0.0019, unit: "request", notes: "ScrapeCreators $0.0019/request (LinkedIn/Instagram/Facebook). Source: competitor review 2026-10-06; pricing page URL unverified; checked 2026-10-06" },
  { provider: "browser_run", action: "browser_hour", unitCostUsd: 0.09, unit: "hour", notes: "Cloudflare Browser Run $0.09/hour after 10 free hours/month; use X-Browser-Ms-Used. Source: https://developers.cloudflare.com/browser-rendering/pricing/ ; checked 2026-10-06" },
];

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { value: number; expires: number }>();

export function clearPriceCache(): void {
  cache.clear();
}

export function fallbackUnitCost(provider: string, action: string): number {
  return (
    DEFAULT_PRICES.find((p) => p.provider === provider && p.action === action)
      ?.unitCostUsd ?? 0
  );
}

/**
 * Unit price in USD for a provider action. Reads `provider_price` (latest row
 * effective at `at`), cached for 60s when `at` is omitted. Any DB problem or
 * missing row falls back to DEFAULT_PRICES; unknown actions price at 0.
 */
export async function getUnitCost(
  provider: string,
  action: string,
  at?: Date,
): Promise<number> {
  const key = `${provider}\u0000${action}`;
  const now = Date.now();
  if (!at) {
    const hit = cache.get(key);
    if (hit && hit.expires > now) return hit.value;
  }
  let value: number | null = null;
  try {
    const rows = await getDb()
      .select({ unitCostUsd: providerPrice.unitCostUsd })
      .from(providerPrice)
      .where(
        and(
          eq(providerPrice.provider, provider),
          eq(providerPrice.action, action),
          lte(providerPrice.effectiveFrom, at ?? new Date(now)),
        ),
      )
      .orderBy(desc(providerPrice.effectiveFrom))
      .limit(1);
    const parsed = rows[0] ? Number(rows[0].unitCostUsd) : NaN;
    if (Number.isFinite(parsed) && parsed >= 0) value = parsed;
  } catch (err) {
    console.error("[cost] price lookup failed; using fallback", {
      provider,
      action,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  const resolved = value ?? fallbackUnitCost(provider, action);
  if (!at) cache.set(key, { value: resolved, expires: now + CACHE_TTL_MS });
  return resolved;
}
