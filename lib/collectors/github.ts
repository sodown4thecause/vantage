import { contentHash } from "@/lib/collectors/hash";
import { parseValidDate } from "@/lib/collectors/date";
import type { Collector } from "@/lib/collectors/types";
import { withCost } from "@/lib/costs/meter";
import type { NewDocument } from "@/lib/db/schema";
import { fetchPublicText, isPublicHttpUrl } from "@/lib/http/public-fetch";

type Issue = {
  id: number; number?: number; html_url?: string; title?: string; body?: string | null;
  created_at?: string; updated_at?: string; comments?: number;
  user?: { login?: string }; labels?: Array<{ name?: string }>;
};
type SearchResult = { page: { items: Issue[]; total_count?: number; incomplete_results?: boolean } } | { deferUntil: number };

export const githubCollector: Collector = {
  name: "github",
  async run(ctx) {
    ctx.signal?.throwIfAborted();
    const configured = Array.isArray(ctx.config.queries) ? ctx.config.queries : [ctx.config.query ?? "AI coding"];
    const queries = configured.filter((q): q is string => typeof q === "string" && Boolean(q.trim())).slice(0, 3);
    if (!queries.length || queries.some(q => q.length > 500)) throw new Error("GitHub requires a query of 1-500 characters");
    const maxPages = Math.min(2, Math.max(1, Math.floor(Number(ctx.config.maxPages) || 1)));
    const now = Math.floor(Date.now() / 1000);
    const lookback = Math.min(168, Math.max(1, Number(ctx.config.lookbackHours) || 72));
    const cursor = Number(ctx.cursor);
    let state: { since?: number; until?: number; queryIndex?: number; nextPage?: number; deferUntil?: number } = {};
    try { const value = JSON.parse(ctx.cursor ?? "{}"); if (value && typeof value === "object" && !Array.isArray(value)) state = value; } catch { /* Legacy numeric cursor is accepted below. */ }
    const until = state.until ?? now;
    const since = state.since ?? (Number.isFinite(cursor) && cursor > 0 && cursor <= now ? cursor : now - Math.ceil(lookback * 3600));
    const firstQuery = state.queryIndex ?? 0;
    const firstPage = state.nextPage ?? 1;
    if (!Number.isSafeInteger(since) || since < 0 || !Number.isSafeInteger(until) || until < since || until > now || !Number.isSafeInteger(firstQuery) || firstQuery < 0 || firstQuery >= queries.length || !Number.isSafeInteger(firstPage) || firstPage < 1 || firstPage > 2 || (state.deferUntil !== undefined && (!Number.isSafeInteger(state.deferUntil) || state.deferUntil < 0))) throw new Error("Invalid GitHub pagination cursor");
    if (state.deferUntil && state.deferUntil > now) return {
      documents: [], partial: true, coverageReason: `GitHub API rate limit; retry after ${state.deferUntil}`,
      nextState: { cursor: ctx.cursor },
    };
    const issues = new Map<number, { issue: Issue; partial: boolean }>();
    let deferredCursor: string | undefined;
    let coverageReason: string | undefined;
    let upstreamPartial = false;

    // ponytail: sample at most two pages per query; use a separate backfill for history.
    search: for (let queryIndex = firstQuery; queryIndex < queries.length; queryIndex++) {
      const query = queries[queryIndex];
      const startPage = queryIndex === firstQuery ? firstPage : 1;
      for (let page = startPage; page <= Math.max(maxPages, startPage); page++) {
        ctx.signal?.throwIfAborted();
        const url = new URL("https://api.github.com/search/issues");
        url.searchParams.set("q", `${query.trim()} is:public is:issue updated:>=${new Date(since * 1000).toISOString()} updated:<=${new Date(until * 1000).toISOString()}`);
        url.searchParams.set("sort", "updated"); url.searchParams.set("order", "desc");
        url.searchParams.set("per_page", "30"); url.searchParams.set("page", String(page));
        const result = await withCost<SearchResult>({ sourceKey: ctx.sourceId, workspaceId: ctx.workspaceId, provider: "github", action: "search_issues", isFailure: result => "deferUntil" in result }, async () => {
          const { response, text } = await fetchPublicText(url.toString(), { signal: ctx.signal, headers: { Accept: "application/vnd.github+json", "User-Agent": "Vantage-public-collector", "X-GitHub-Api-Version": "2022-11-28" }, cache: "no-store" }, 1_000_000, fetch, 30_000);
          if (response.status === 429 || (response.status === 403 && (response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after")))) {
            const observedAt = Math.floor(Date.now() / 1000);
            const retryAfter = response.headers.get("retry-after");
            const retrySeconds = retryAfter === null ? NaN : Number(retryAfter);
            const retryAt = Number.isFinite(retrySeconds) && retrySeconds >= 0 ? observedAt + Math.ceil(retrySeconds) : Math.ceil(Date.parse(retryAfter ?? "") / 1000);
            const resetAt = Number(response.headers.get("x-ratelimit-reset"));
            const deadlines = [retryAt, resetAt].filter(value => Number.isSafeInteger(value) && value > observedAt);
            return { deferUntil: deadlines.length ? Math.max(...deadlines) : observedAt + 60 };
          }
          if (!response.ok) throw new Error(`GitHub API request failed (${response.status})`);
          const parsed = JSON.parse(text) as { items: Issue[]; total_count?: number; incomplete_results?: boolean };
          if (!Array.isArray(parsed?.items)) throw new Error("Invalid GitHub issues response");
          return { page: parsed };
        });
        ctx.signal?.throwIfAborted();
        if ("deferUntil" in result) {
          deferredCursor = JSON.stringify({ since, until, queryIndex, nextPage: page, deferUntil: result.deferUntil });
          coverageReason = `GitHub API rate limit; retry after ${result.deferUntil}`;
          break search;
        }
        const data = result.page;
        upstreamPartial ||= data.incomplete_results === true || (page === Math.max(maxPages, startPage) && Number(data.total_count ?? 0) > page * 30);
        for (const issue of data.items) if (issue && Number.isSafeInteger(issue.id) && issue.id > 0) issues.set(issue.id, { issue, partial: data.incomplete_results === true });
        if (!data.items.length || page * 30 >= Number(data.total_count ?? 0)) break;
      }
    }

    const documents: NewDocument[] = [];
    for (const { issue, partial } of issues.values()) {
      if (typeof issue.html_url !== "string" || !isPublicHttpUrl(issue.html_url)) continue;
      const url = new URL(issue.html_url);
      if (url.hostname !== "github.com" || !/^\/[^/]+\/[^/]+\/issues\/\d+\/?$/.test(url.pathname)) continue;
      url.search = ""; url.hash = "";
      const urlCanonical = url.toString();
      const title = typeof issue.title === "string" ? issue.title : "";
      const contentMd = typeof issue.body === "string" && issue.body.trim() ? issue.body : title;
      if (!contentMd) continue;
      documents.push({ workspaceId: ctx.workspaceId, sourceId: ctx.sourceId, platform: "github", urlCanonical,
        title: title || null, contentMd, authorRef: typeof issue.user?.login === "string" ? issue.user.login : null,
        postedAt: parseValidDate(typeof issue.created_at === "string" ? issue.created_at : null),
        contentHash: contentHash("github", urlCanonical, contentMd), rawSnapshotRef: `github:issue:${issue.id}`,
        metadata: { provider: "github", issueId: issue.id, issueNumber: issue.number ?? null, commentCount: issue.comments ?? 0,
          updatedAt: issue.updated_at ?? null, partial, topReplies: [], threadContext: contentMd,
          labels: Array.isArray(issue.labels) ? issue.labels.map(label => label?.name).filter(name => typeof name === "string").slice(0, 20) : [],
          rulesUrl: "https://docs.github.com/en/site-policy/github-terms/github-community-guidelines" } });
    }
    return { documents, partial: deferredCursor !== undefined || upstreamPartial,
      coverageReason: coverageReason ?? (upstreamPartial ? "GitHub search returned a bounded or incomplete sample" : undefined),
      nextState: { cursor: deferredCursor ?? String(until) } };
  },
};
