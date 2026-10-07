import type { CostContext } from "@/lib/costs/meter";
import { fetchPublicText } from "@/lib/http/public-fetch";
import { runPaidCall } from "@/lib/providers/paid-call";

export type AlexandriaRequest =
  | { provider: "firecrawl-developer-index"; capability: "search"; options: { query: string; k: number; passages: number; types?: string[]; repos?: string[] } }
  | { provider: "github-com"; capability: "repositories/issues"; options: { repo: string; page: number; per_page: number; state: "open" | "closed" | "all"; sort: "updated"; direction: "desc"; include_pull_requests: false; labels?: string[] } };

export type AlexandriaPage = { records: Record<string, unknown>[]; partial: boolean; hasNext: boolean };

export async function runAlexandria(request: AlexandriaRequest, context: CostContext, signal?: AbortSignal): Promise<AlexandriaPage> {
  signal?.throwIfAborted();
  if (!((request.provider === "firecrawl-developer-index" && request.capability === "search") || (request.provider === "github-com" && request.capability === "repositories/issues"))) throw new Error("Alexandria dataset is not supported by the allowlist");
  const key = process.env.FIRECRAWL_API_KEY?.trim();
  if (!key) throw new Error("FIRECRAWL_API_KEY is not configured");
  const creditUsd = Number(process.env.FIRECRAWL_CREDIT_USD);
  if (!Number.isFinite(creditUsd) || creditUsd <= 0) throw new Error("FIRECRAWL_CREDIT_USD conversion must be configured and positive");
  const estimatedCredits = request.provider === "firecrawl-developer-index" ? Math.ceil(request.options.k / 10) * 2 : 5;
  return runPaidCall({ context, provider: "firecrawl", action: `${request.provider}/${request.capability}`, estimateUsd: estimatedCredits * creditUsd, signal }, async () => {
    const { response, text } = await fetchPublicText("https://api.firecrawl.dev/v2/scrape", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ alexandria: [request] }), signal, cache: "no-store" }, 1_000_000, fetch, 30_000);
    if (!response.ok) throw new Error(`Firecrawl dataset request failed (${response.status})`);
    const payload = JSON.parse(text) as { success?: boolean; data?: { creditsCost?: number; alexandria?: Array<{ provider?: string; capability?: string; creditsCost?: number; data?: { success?: boolean; partial?: boolean; has_next?: boolean; results?: Record<string, unknown>[]; issues?: Record<string, unknown>[] } }> } };
    const result = Array.isArray(payload.data?.alexandria) ? payload.data.alexandria.find(item => item?.provider === request.provider && item.capability === request.capability) : undefined;
    if (payload.success !== true || !result?.data || result.data.success === false) throw new Error("Firecrawl dataset execution failed or returned an invalid response");
    const records = request.provider === "github-com" ? result.data.issues : result.data.results;
    if (!Array.isArray(records)) throw new Error("Invalid Firecrawl dataset response records");
    signal?.throwIfAborted();
    const credits = payload.data?.creditsCost ?? result.creditsCost;
    return { value: { records: records.filter(item => item && typeof item === "object" && !Array.isArray(item)), partial: result.data.partial === true, hasNext: result.data.has_next === true },
      costUsd: typeof credits === "number" && Number.isFinite(credits) && credits >= 0 ? credits * creditUsd : undefined };
  });
}
