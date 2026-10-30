import { z } from "zod";

import { dataForSeoCacheKey, readDataForSeoCache, writeDataForSeoCache } from "@/lib/dataforseo/cache";
import { optionalEnv } from "@/lib/env/required";
import { fetchPublicText, isPublicHttpUrl } from "@/lib/http/public-fetch";
import { runPaidCall } from "@/lib/providers/paid-call";

const API_BASE = "https://api.linkup.so/v1";
const CACHE_SECONDS = 24 * 60 * 60;
const MAX_RESPONSE_BYTES = 1_000_000;
const SEARCH_COST_USD = 0.005;
const FETCH_COST_USD = 0.001;

const bareDomain = z.string().trim().min(1).max(253)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i);
const domainList = z.array(bareDomain).max(100).optional().transform((domains) =>
  domains ? [...new Set(domains.map((domain) => domain.toLowerCase()))].sort() : undefined);

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && value > "1970-01-01";
}

export const linkupSearchInputSchema = z.object({
  query: z.string().trim().min(1).max(500),
  includeDomains: domainList,
  excludeDomains: domainList,
  fromDate: z.string().trim().refine(validDate, "Use a valid date after 1970-01-01 in YYYY-MM-DD format.").optional(),
}).strict();

export const linkupFetchInputSchema = z.object({
  url: z.string().trim().url().refine(isPublicHttpUrl, "A public HTTP(S) URL is required."),
}).strict();

export type LinkupSearchInput = z.input<typeof linkupSearchInputSchema>;
export type LinkupSearchResult = { title: string; url: string; snippet: string };
export type LinkupSearchResponse = { results: LinkupSearchResult[] };
export type LinkupPageResponse = { url: string; markdown: string };

/** `sourceKey` attributes the spend in the cost ledger; callers other than the SEO agent (discovery) pass their own. */
type CallOptions = { workspaceId: string; sourceKey?: string; signal?: AbortSignal; fetchImpl?: typeof fetch };

export class LinkupNotConfiguredError extends Error {
  constructor() {
    super("Linkup is not configured.");
    this.name = "LinkupNotConfiguredError";
  }
}

class LinkupResponseError extends Error {
  constructor() {
    super("Linkup returned an unusable response.");
    this.name = "LinkupResponseError";
  }
}

function normalizedSearch(input: LinkupSearchInput): LinkupSearchInput {
  return linkupSearchInputSchema.parse(input);
}

function cacheKey(workspaceId: string, endpoint: string, params: Record<string, unknown>): string {
  // The digest is workspace-scoped so private query wording cannot share cached results across workspaces.
  return dataForSeoCacheKey("live", `linkup:${endpoint}`, { workspaceId, ...params });
}

function safeResult(value: unknown): LinkupSearchResult | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const title = typeof row.name === "string" ? row.name.trim() : typeof row.title === "string" ? row.title.trim() : "";
  const url = typeof row.url === "string" ? row.url.trim() : "";
  const snippet = typeof row.content === "string" ? row.content.trim() : "";
  if (!title || !isPublicHttpUrl(url)) return null;
  return { title: title.slice(0, 500), url, snippet: snippet.slice(0, 2000) };
}

function parseSearchResponse(value: unknown): LinkupSearchResponse | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const results = (value as Record<string, unknown>).results;
  if (!Array.isArray(results)) return null;
  return { results: results.flatMap((row) => {
    const parsed = safeResult(row);
    return parsed ? [parsed] : [];
  }).slice(0, 20) };
}

async function postJson(
  path: "search" | "fetch",
  body: Record<string, unknown>,
  opts: { fetchImpl?: typeof fetch; signal?: AbortSignal },
): Promise<{ response: Response; text: string }> {
  const apiKey = optionalEnv("LINKUP_API_KEY");
  if (!apiKey) throw new LinkupNotConfiguredError();
  return fetchPublicText(`${API_BASE}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    ...(opts.signal ? { signal: opts.signal } : {}),
  }, MAX_RESPONSE_BYTES, opts.fetchImpl ?? fetch, 30_000);
}

function jsonFromText(text: string): unknown {
  try { return JSON.parse(text) as unknown; }
  catch { return null; }
}

/** Search Linkup at the standard, search-results-only price; public query responses are cached for 24 hours. */
export async function searchLinkup(input: LinkupSearchInput, opts: CallOptions): Promise<{ value: LinkupSearchResponse; cached: boolean }> {
  const params = normalizedSearch(input);
  const key = cacheKey(opts.workspaceId, "search", {
    query: params.query,
    depth: "standard",
    outputType: "searchResults",
    includeDomains: params.includeDomains ?? [],
    excludeDomains: params.excludeDomains ?? [],
    fromDate: params.fromDate ?? null,
  });
  const hit = await readDataForSeoCache<LinkupSearchResponse>(key, CACHE_SECONDS);
  if (hit !== null) return { value: hit, cached: true };
  if (!optionalEnv("LINKUP_API_KEY")) throw new LinkupNotConfiguredError();

  const value = await runPaidCall<LinkupSearchResponse>({
    context: { workspaceId: opts.workspaceId, sourceKey: opts.sourceKey ?? "seo" },
    provider: "linkup",
    action: "web_research",
    estimateUsd: SEARCH_COST_USD,
    signal: opts.signal,
  }, async () => {
    const { response, text } = await postJson("search", {
      q: params.query,
      depth: "standard",
      outputType: "searchResults",
      maxResults: 10,
      ...(params.includeDomains ? { includeDomains: params.includeDomains } : {}),
      ...(params.excludeDomains ? { excludeDomains: params.excludeDomains } : {}),
      ...(params.fromDate ? { fromDate: params.fromDate } : {}),
    }, opts);
    if (!response.ok) return { error: new LinkupResponseError(), costUsd: 0 };
    const parsed = parseSearchResponse(jsonFromText(text));
    if (!parsed) return { error: new LinkupResponseError(), costUsd: SEARCH_COST_USD };
    return { value: parsed, costUsd: SEARCH_COST_USD };
  });

  await writeDataForSeoCache(key, "linkup:search", value);
  return { value, cached: false };
}

/** Fetch a public page through Linkup's standard, non-JavaScript mode; cache the Markdown for 24 hours. */
export async function fetchLinkupPage(url: string, opts: CallOptions): Promise<{ value: LinkupPageResponse; cached: boolean }> {
  const pageUrl = linkupFetchInputSchema.parse({ url }).url;
  const key = cacheKey(opts.workspaceId, "fetch", { url: pageUrl, mode: "standard", renderJs: false });
  const hit = await readDataForSeoCache<LinkupPageResponse>(key, CACHE_SECONDS);
  if (hit !== null) return { value: hit, cached: true };
  if (!optionalEnv("LINKUP_API_KEY")) throw new LinkupNotConfiguredError();

  const value = await runPaidCall<LinkupPageResponse>({
    context: { workspaceId: opts.workspaceId, sourceKey: opts.sourceKey ?? "seo" },
    provider: "linkup",
    action: "fetch_page",
    estimateUsd: FETCH_COST_USD,
    signal: opts.signal,
  }, async () => {
    const { response, text } = await postJson("fetch", {
      url: pageUrl,
      mode: "standard",
      renderJs: false,
      includeRawContent: false,
      includeRawHtml: false,
      extractImages: false,
    }, opts);
    if (!response.ok) return { error: new LinkupResponseError(), costUsd: 0 };
    const payload = jsonFromText(text);
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      return { error: new LinkupResponseError(), costUsd: FETCH_COST_USD };
    }
    const markdown = (payload as Record<string, unknown>).markdown;
    if (typeof markdown !== "string") return { error: new LinkupResponseError(), costUsd: FETCH_COST_USD };
    return { value: { url: pageUrl, markdown: markdown.slice(0, 12_000) }, costUsd: FETCH_COST_USD };
  });

  await writeDataForSeoCache(key, "linkup:fetch", value);
  return { value, cached: false };
}
