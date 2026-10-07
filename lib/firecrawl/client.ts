import type { CostContext } from "@/lib/costs/meter";
import { fetchPublicText } from "@/lib/http/public-fetch";
import { runPaidCall } from "@/lib/providers/paid-call";

export type AlexandriaRequest =
  | { provider: "firecrawl-developer-index"; capability: "search"; options: { query: string; k: number; passages: number; types?: string[]; repos?: string[] } }
  | { provider: "github-com"; capability: "repositories/issues"; options: { repo: string; page: number; per_page: number; state: "open" | "closed" | "all"; sort: "updated"; direction: "desc"; include_pull_requests: false; labels?: string[] } };

export type AlexandriaPage = { records: Record<string, unknown>[]; partial: boolean; hasNext: boolean };
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

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
    let payload: unknown;
    try { payload = JSON.parse(text); } catch { throw new Error("Invalid Firecrawl dataset response"); }
    if (!isRecord(payload)) throw new Error("Invalid Firecrawl dataset response");
    const data = isRecord(payload.data) ? payload.data : undefined;
    const result = Array.isArray(data?.alexandria) ? data.alexandria.find((item): item is Record<string, unknown> =>
      isRecord(item) && item.provider === request.provider && item.capability === request.capability) : undefined;
    const resultData = result && isRecord(result.data) ? result.data : undefined;
    if (payload.success !== true || !resultData || resultData.success === false) throw new Error("Firecrawl dataset execution failed or returned an invalid response");
    const records = request.provider === "github-com" ? resultData.issues : resultData.results;
    if (!Array.isArray(records)) throw new Error("Invalid Firecrawl dataset response records");
    signal?.throwIfAborted();
    const credits = data?.creditsCost ?? result?.creditsCost;
    return { value: { records: records.filter(isRecord), partial: resultData.partial === true, hasNext: resultData.has_next === true },
      costUsd: typeof credits === "number" && Number.isFinite(credits) && credits >= 0 ? credits * creditUsd : undefined };
  });
}
