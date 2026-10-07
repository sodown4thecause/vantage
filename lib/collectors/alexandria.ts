import { contentHash } from "@/lib/collectors/hash";
import { parseValidDate } from "@/lib/collectors/date";
import type { Collector } from "@/lib/collectors/types";
import type { NewDocument } from "@/lib/db/schema";
import { runAlexandria, type AlexandriaRequest } from "@/lib/firecrawl/client";
import { isPublicHttpUrl } from "@/lib/http/public-fetch";

export const alexandriaCollector: Collector = {
  name: "alexandria",
  async run(ctx) {
    ctx.signal?.throwIfAborted();
    const provider = ctx.config.provider ?? "firecrawl-developer-index";
    const capability = ctx.config.capability ?? "search";
    const limit = Math.min(30, Math.max(1, Math.floor(Number(ctx.config.maxResults) || 10)));
    const context = { workspaceId: ctx.workspaceId, sourceKey: ctx.sourceId };
    let request: AlexandriaRequest;
    if (provider === "firecrawl-developer-index" && capability === "search") {
      const query = typeof ctx.config.query === "string" ? ctx.config.query.trim() : "";
      if (!query || query.length > 500) throw new Error("Alexandria developer search requires a query of 1-500 characters");
      const types = Array.isArray(ctx.config.types) ? ctx.config.types.filter((v): v is string => typeof v === "string" && v.length <= 80).slice(0, 5) : undefined;
      const repos = Array.isArray(ctx.config.repos) ? ctx.config.repos.filter((v): v is string => typeof v === "string" && /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(v)).slice(0, 5) : undefined;
      request = { provider, capability, options: { query, k: limit, passages: Math.min(5, Math.max(1, Math.floor(Number(ctx.config.passages) || 1))), ...(types?.length ? { types } : {}), ...(repos?.length ? { repos } : {}) } };
    } else if (provider === "github-com" && capability === "repositories/issues") {
      const repo = typeof ctx.config.repo === "string" ? ctx.config.repo.trim() : "";
      if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9._-]{1,100}$/.test(repo)) throw new Error("Alexandria requires a public repository as owner/name");
      const state = ctx.config.state === "closed" || ctx.config.state === "all" ? ctx.config.state : "open";
      const labels = Array.isArray(ctx.config.labels) ? ctx.config.labels.filter((v): v is string => typeof v === "string" && v.length <= 100).slice(0, 10) : undefined;
      request = { provider, capability, options: { repo, page: 1, per_page: limit, state, sort: "updated", direction: "desc", include_pull_requests: false, ...(labels?.length ? { labels } : {}) } };
    } else throw new Error("Alexandria dataset is not supported by the allowlist");

    const documents = new Map<string, NewDocument>();
    const maxPages = request.provider === "github-com" ? Math.min(2, Math.max(1, Math.floor(Number(ctx.config.maxPages) || 1))) : 1;
    let remaining = limit;
    let partial = request.provider === "firecrawl-developer-index";
    for (let page = 1; page <= maxPages && remaining > 0; page++) {
      ctx.signal?.throwIfAborted();
      if (request.provider === "github-com") request = { ...request, options: { ...request.options, page } };
      const result = await runAlexandria(request, context, ctx.signal);
      partial ||= result.partial;
      const records = result.records.slice(0, remaining);
      remaining -= records.length;
      if (result.hasNext && (remaining === 0 || page === maxPages)) partial = true;
      for (const record of records) {
        const rawUrl = request.provider === "github-com" ? record.source_url : record.url;
        if (typeof rawUrl !== "string" || !isPublicHttpUrl(rawUrl) || record.is_pull_request === true) continue;
        const url = new URL(rawUrl); url.hash = "";
        if (request.provider === "github-com" && (url.hostname !== "github.com" || !/^\/[^/]+\/[^/]+\/issues\/\d+\/?$/.test(url.pathname))) continue;
        if (url.hostname === "github.com") url.search = "";
        const urlCanonical = url.toString();
        const title = typeof record.title === "string" ? record.title : "";
        const passages = Array.isArray(record.passages) ? record.passages.slice(0, 5).flatMap(passage => passage && typeof passage === "object" && typeof passage.text === "string" ? [passage.text] : []) : [];
        const contentMd = typeof record.body === "string" && record.body.trim() ? record.body : passages.join("\n\n") || title;
        if (!contentMd) continue;
        const platform = url.hostname === "github.com" ? "github" : "rss";
        const author = record.user && typeof record.user === "object" && "login" in record.user && typeof record.user.login === "string" ? record.user.login : null;
        const dataset = `${request.provider}/${request.capability}`;
        documents.set(urlCanonical, { workspaceId: ctx.workspaceId, sourceId: ctx.sourceId, platform, urlCanonical, title: title || null,
          contentMd, authorRef: author, postedAt: parseValidDate(typeof record.created_at === "string" ? record.created_at : null),
          contentHash: contentHash(platform, urlCanonical, contentMd), rawSnapshotRef: `firecrawl:${dataset}:${record.id ?? urlCanonical}`,
          metadata: { provider: "firecrawl", dataset, externalId: record.id ?? null, partial: result.partial,
            discoveryOnly: request.provider === "firecrawl-developer-index", threadContext: contentMd, topReplies: [] } });
      }
      if (!result.hasNext || !result.records.length) break;
    }
    return { documents: [...documents.values()], partial, coverageReason: partial ? "Partial dataset coverage. Read the original conversation before acting." : undefined };
  },
};
