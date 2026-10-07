import { contentHash } from "@/lib/collectors/hash";
import type { Collector } from "@/lib/collectors/types";
import type { NewDocument } from "@/lib/db/schema";
import { fetchPublicText, isPublicHttpUrl } from "@/lib/http/public-fetch";
import { runPaidCall } from "@/lib/providers/paid-call";

type IndexedPage = {
  organic_results: Array<{ title?: string; link?: string; snippet?: string; date?: string }>;
  pagination?: { next?: string };
};
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const invalidResponse = () => new Error("Invalid Scavio indexed search response.");

function readPage(value: unknown): IndexedPage {
  if (!isRecord(value) || (value.success !== undefined && typeof value.success !== "boolean") || value.success === false ||
      !Array.isArray(value.organic_results) || !value.organic_results.every(item => isRecord(item) &&
        ["title", "link", "snippet", "date"].every(field => item[field] === undefined || typeof item[field] === "string")) ||
      (value.pagination !== undefined && (!isRecord(value.pagination) ||
        (value.pagination.next !== undefined && typeof value.pagination.next !== "string")))) throw invalidResponse();
  return value as IndexedPage;
}

export const linkedinCollector: Collector = {
  name: "linkedin",
  async run(ctx) {
    ctx.signal?.throwIfAborted();
    const key = process.env.SCAVIO_API_KEY?.trim();
    if (!key) throw new Error("SCAVIO_API_KEY is not configured");
    const unitCost = Number(process.env.SCAVIO_GOOGLE_COST_USD);
    if (!Number.isFinite(unitCost) || unitCost <= 0) throw new Error("SCAVIO_GOOGLE_COST_USD must be configured and positive");
    const query = typeof ctx.config.query === "string" ? ctx.config.query.trim() : "";
    if (!query || query.length > 450) throw new Error("LinkedIn indexed search requires a query of 1-450 characters");
    const maxPages = Math.min(2, Math.max(1, Math.floor(Number(ctx.config.maxPages) || 1)));
    const limit = Math.min(20, Math.max(1, Math.floor(Number(ctx.config.maxResults) || 10)));
    const documents = new Map<string, NewDocument>();
    // Scavio 0.16's LinkedIn searchPosts is retired; Google supplies public indexed snippets.
    for (let page = 0; page < maxPages && documents.size < limit; page++) {
      ctx.signal?.throwIfAborted();
      const data = await runPaidCall<IndexedPage>({ context: { workspaceId: ctx.workspaceId, sourceKey: ctx.sourceId }, provider: "scavio", action: "linkedin_indexed_search", estimateUsd: unitCost, signal: ctx.signal }, async () => {
        const { response, text } = await fetchPublicText("https://api.scavio.dev/api/v2/google", { method: "POST", signal: ctx.signal, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: `site:linkedin.com/posts/ ${query}`, start: page * 10, include_html: false, resolve_ai_overview: false }), cache: "no-store" }, 512_000, fetch, 30_000);
        if (!response.ok) throw new Error(`Scavio indexed LinkedIn request failed (${response.status})`);
        let value: unknown;
        try { value = JSON.parse(text); } catch { throw invalidResponse(); }
        if (!isRecord(value)) throw invalidResponse();
        const credits = value.credits_used;
        if (credits !== undefined && (typeof credits !== "number" || !Number.isFinite(credits) || credits < 0)) throw invalidResponse();
        const costUsd = credits === undefined ? undefined : credits * unitCost;
        if (costUsd !== undefined && !Number.isFinite(costUsd)) throw invalidResponse();
        // Preserve known credits while marking unusable responses as failed retrievals.
        try {
          ctx.signal?.throwIfAborted();
          return { value: readPage(value), costUsd };
        } catch (error) {
          return { error: error instanceof Error ? error : invalidResponse(), costUsd };
        }
      });
      for (const item of data.organic_results.slice(0, 10)) {
        if (!item || typeof item.link !== "string" || !isPublicHttpUrl(item.link)) continue;
        const url = new URL(item.link);
        if (!["linkedin.com", "www.linkedin.com"].includes(url.hostname) || !(/^\/posts\/[^/]*activity-\d+[^/]*\/?$/.test(url.pathname) || /^\/feed\/update\/urn:li:activity:\d+\/?$/.test(url.pathname))) continue;
        url.search = ""; url.hash = "";
        const urlCanonical = url.toString();
        const title = typeof item.title === "string" ? item.title : "";
        const contentMd = typeof item.snippet === "string" && item.snippet.trim() ? item.snippet : title;
        if (!contentMd) continue;
        documents.set(urlCanonical, { workspaceId: ctx.workspaceId, sourceId: ctx.sourceId, platform: "linkedin", urlCanonical,
          title: title || null, contentMd, postedAt: null, authorRef: null, contentHash: contentHash("linkedin", urlCanonical, contentMd),
          rawSnapshotRef: urlCanonical, metadata: { provider: "scavio", coverage: "indexed_public_snippets", partial: true, discoveryOnly: true,
            threadContext: contentMd, topReplies: [], rulesUrl: "https://www.linkedin.com/legal/professional-community-policies" } });
        if (documents.size >= limit) break;
      }
      if (!data.pagination?.next || !data.organic_results.length) break;
    }
    return { documents: [...documents.values()], partial: true, coverageReason: "Public indexed snippets; conversation coverage is incomplete." };
  },
};
