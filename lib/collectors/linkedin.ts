import { contentHash } from "@/lib/collectors/hash";
import type { Collector } from "@/lib/collectors/types";
import type { NewDocument } from "@/lib/db/schema";
import { fetchPublicText, isPublicHttpUrl } from "@/lib/http/public-fetch";
import { runPaidCall } from "@/lib/providers/paid-call";

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
      const data = await runPaidCall({ context: { workspaceId: ctx.workspaceId, sourceKey: ctx.sourceId }, provider: "scavio", action: "linkedin_indexed_search", estimateUsd: unitCost, signal: ctx.signal }, async () => {
        const { response, text } = await fetchPublicText("https://api.scavio.dev/api/v2/google", { method: "POST", signal: ctx.signal, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: `site:linkedin.com/posts/ ${query}`, start: page * 10, include_html: false, resolve_ai_overview: false }), cache: "no-store" }, 512_000, fetch, 30_000);
        if (!response.ok) throw new Error(`Scavio indexed LinkedIn request failed (${response.status})`);
        const value = JSON.parse(text) as { organic_results?: Array<{ title?: string; link?: string; snippet?: string }>; pagination?: { next?: string }; credits_used?: number };
        if (!Array.isArray(value?.organic_results)) throw new Error("Invalid Scavio indexed search response results");
        ctx.signal?.throwIfAborted();
        return { value, costUsd: typeof value.credits_used === "number" && Number.isFinite(value.credits_used) && value.credits_used >= 0 ? value.credits_used * unitCost : undefined };
      });
      for (const item of data.organic_results!.slice(0, 10)) {
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
      if (!data.pagination?.next || !data.organic_results!.length) break;
    }
    return { documents: [...documents.values()] };
  },
};
