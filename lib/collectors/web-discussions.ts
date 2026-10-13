import { mapWithConcurrency } from "@/lib/async/map-with-concurrency";
import { BrowserRunError, browserMarkdown } from "@/lib/browser/run";
import { contentHash } from "@/lib/collectors/hash";
import { parseValidDate } from "@/lib/collectors/date";
import type { Collector, CollectorContext, CollectorResult } from "@/lib/collectors/types";
import { ALL_FORUM_DOMAINS, DEVELOPER_FORUM_DOMAINS } from "@/lib/communities/forum-packs";
import type { NewDocument } from "@/lib/db/schema";
import { firecrawlSearch, firecrawlTbs, hasFirecrawlApiKey } from "@/lib/firecrawl/search";
import { isPublicHttpUrl } from "@/lib/http/public-fetch";
import { isPaidCallDenied } from "@/lib/providers/paid-call";
import { hasTinyFishApiKey } from "@/lib/tinyfish/client";
import { tinyFishFetchMarkdown, tinyFishSearch } from "@/lib/tinyfish/search-fetch";

import { bareHost } from "@/lib/collectors/web-provider";

export { WEB_DISCUSSIONS_PROVIDER, bareHost } from "@/lib/collectors/web-provider";
export { DEVELOPER_FORUM_DOMAINS };

export type WebDiscussionKind = "forum" | "blog";

/** Never "blogs": social networks, video, Q&A and code hosts. Known forums are added in the collector. */
const NOT_BLOG_DOMAINS = [
  "reddit.com", "x.com", "twitter.com", "youtube.com", "linkedin.com", "facebook.com", "instagram.com",
  "tiktok.com", "pinterest.com", "quora.com", "news.ycombinator.com", "github.com", "stackoverflow.com",
  "producthunt.com", "wikipedia.org", "amazon.com",
];

const MAX_QUERIES = 3;
/** Cloudflare Browser Run renders at most this many unread pages per scan (billed per browser hour). */
const MAX_BROWSER_PAGES = 5;
const DEFAULT_LOOKBACK_HOURS = 168;

function strings(value: unknown, max: number): string[] {
  if (typeof value === "string") value = [value];
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((v): v is string => typeof v === "string")
    .map(v => v.replace(/\s+/g, " ").trim()).filter(v => v.length >= 2 && v.length <= 100))].slice(0, max);
}

function matchesDomain(host: string, domains: readonly string[]): boolean {
  return domains.some(domain => host === domain || host.endsWith(`.${domain}`));
}

/** Drops fragments and tracking parameters so the same post is one document. */
function canonicalUrl(raw: string): string | undefined {
  if (!isPublicHttpUrl(raw)) return;
  const url = new URL(raw);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|ref$|ref_src$|fbclid$|gclid$|mc_)/i.test(key)) url.searchParams.delete(key);
  }
  url.protocol = "https:";
  return url.toString();
}

type Hit = { url: string; title: string; snippet: string; date?: string; kind: WebDiscussionKind; query: string;
  provider: "tinyfish_search_fetch" | "firecrawl_search" };

function windowStart(ctx: CollectorContext, now: Date): Date {
  const lookbackHours = Math.min(720, Math.max(1, Math.floor(Number(ctx.config.lookbackHours) || DEFAULT_LOOKBACK_HOURS)));
  const floor = new Date(now.getTime() - lookbackHours * 3_600_000);
  const cursor = parseValidDate(ctx.cursor ?? null);
  // Search indexes date at day granularity; overlap the previous run by a day. Duplicates are dropped by content hash.
  const resumed = cursor ? new Date(cursor.getTime() - 24 * 3_600_000) : floor;
  return resumed > floor ? resumed : floor;
}

/**
 * Keyword search across public developer forums and blogs. TinyFish Search + Fetch first; Firecrawl
 * search (paid gate) only when TinyFish is unavailable. Snippets and page text are untrusted data.
 */
export const webDiscussionsCollector: Collector = {
  name: "web-discussions",
  async run(ctx: CollectorContext): Promise<CollectorResult> {
    ctx.signal?.throwIfAborted();
    const queries = strings(ctx.config.queries ?? ctx.config.query, MAX_QUERIES);
    if (!queries.length) throw new Error("Forum and blog search needs a search phrase of 2 to 100 characters");
    const kinds = strings(ctx.config.kinds, 2).filter((k): k is WebDiscussionKind => k === "forum" || k === "blog");
    if (!kinds.length) kinds.push("forum", "blog");
    const limit = Math.min(20, Math.max(1, Math.floor(Number(ctx.config.maxResults) || 10)));
    const excludeHosts = strings(ctx.config.excludeHosts, 5).map(bareHost).filter((h): h is string => Boolean(h));
    const forumDomains = strings(ctx.config.forumDomains, 20).map(bareHost).filter((h): h is string => Boolean(h));
    const forums = forumDomains.length ? forumDomains : [...DEVELOPER_FORUM_DOMAINS];
    // Every known forum, not only this source's, so a forum post from any pack never lands as a blog.
    const notBlogs = [...new Set([...NOT_BLOG_DOMAINS, ...ALL_FORUM_DOMAINS, ...forums, ...excludeHosts])];
    const now = new Date();
    const since = windowStart(ctx, now);
    const lookbackHours = (now.getTime() - since.getTime()) / 3_600_000;
    const costContext = { workspaceId: ctx.workspaceId, sourceKey: ctx.sourceId };
    const tinyFish = hasTinyFishApiKey();
    const firecrawl = hasFirecrawlApiKey();
    if (!tinyFish && !firecrawl) throw new Error("Access pending: configure TinyFish or Firecrawl credentials");

    const hits: Hit[] = [];
    const failures: string[] = [];
    let searches = 0;
    for (const kind of kinds) {
      for (const query of queries) {
        ctx.signal?.throwIfAborted();
        searches++;
        const domainFilter = kind === "forum" ? { includeDomains: forums } : { excludeDomains: notBlogs };
        let tinyFishError: unknown;
        if (tinyFish) {
          try {
            const rows = await tinyFishSearch(kind === "blog" ? `${query} blog` : query, {
              ...domainFilter, afterDate: since.toISOString().slice(0, 10), ctx: costContext, signal: ctx.signal,
              purpose: `Find recent public ${kind === "forum" ? "developer forum threads" : "blog posts"} where people discuss ${JSON.stringify(query)}.` });
            hits.push(...rows.map(row => ({ ...row, kind, query, provider: "tinyfish_search_fetch" as const })));
            continue;
          } catch (error) {
            ctx.signal?.throwIfAborted();
            tinyFishError = error;
          }
        }
        if (firecrawl) {
          try {
            const rows = await firecrawlSearch(kind === "blog" ? `${query} blog` : query, {
              ...domainFilter, limit, tbs: firecrawlTbs(lookbackHours), context: costContext, signal: ctx.signal });
            hits.push(...rows.map(row => ({ ...row, kind, query, provider: "firecrawl_search" as const })));
            continue;
          } catch (error) {
            ctx.signal?.throwIfAborted();
            failures.push(isPaidCallDenied(error) ? "Firecrawl fallback needs paid-provider opt-in" : "Firecrawl search failed");
            continue;
          }
        }
        failures.push(tinyFishError ? "TinyFish search failed" : "No search provider available");
      }
    }
    if (failures.length === searches) throw new Error(`Forum and blog search unavailable: ${[...new Set(failures)].join("; ")}`);

    // Keep the newest-ranked unique hits per kind, skipping the owner's own site and anything outside the kind's domains.
    const picked = new Map<string, Hit>();
    const perKind = Math.ceil(limit / kinds.length);
    const kindCounts: Record<WebDiscussionKind, number> = { forum: 0, blog: 0 };
    for (const hit of hits) {
      const url = canonicalUrl(hit.url);
      const host = url && bareHost(url);
      if (!url || !host || picked.has(url) || !hit.title.trim() || kindCounts[hit.kind] >= perKind) continue;
      if (matchesDomain(host, excludeHosts)) continue;
      if (hit.kind === "forum" ? !matchesDomain(host, forums) : matchesDomain(host, notBlogs)) continue;
      if (new URL(url).pathname.length <= 1) continue; // A home page is not a conversation.
      const posted = parseValidDate(hit.date ?? null);
      if (posted && posted < since) continue;
      picked.set(url, { ...hit, url });
      kindCounts[hit.kind]++;
      if (picked.size >= limit) break;
    }

    const pages = new Map<string, string>();
    if (tinyFish && picked.size) {
      try {
        const fetched = await tinyFishFetchMarkdown([...picked.keys()], { ctx: costContext, signal: ctx.signal,
          purpose: "Read these public forum threads and blog posts. Preserve literal text; do not log in." });
        for (const page of fetched) {
          const url = canonicalUrl(page.url);
          if (url && page.text.trim()) pages.set(url, page.text.slice(0, 20_000));
        }
      } catch {
        // Best effort: Browser Run below, then search snippets, cover pages TinyFish Fetch could not read.
        ctx.signal?.throwIfAborted();
      }
    }
    ctx.signal?.throwIfAborted();

    // Second reader: Cloudflare Browser Run renders pages TinyFish could not read (or never saw, on the Firecrawl path).
    const unread = [...picked.keys()].filter(url => !pages.has(url)).slice(0, MAX_BROWSER_PAGES);
    const browserRead = new Set<string>();
    let browserUnavailable = false;
    if (unread.length) {
      await mapWithConcurrency(unread, 2, async url => {
        if (browserUnavailable) return;
        try {
          const { markdown } = await browserMarkdown(url, { workspaceId: ctx.workspaceId, timeoutMs: 15_000 });
          if (markdown.trim()) { pages.set(url, markdown.slice(0, 20_000)); browserRead.add(url); }
        } catch (error) {
          ctx.signal?.throwIfAborted();
          // No binding (local dev, tests) or the operator paused Browser Run: stop trying for this scan.
          if (error instanceof BrowserRunError && ["binding_missing", "source_paused"].includes(error.code)) browserUnavailable = true;
        }
      });
      ctx.signal?.throwIfAborted();
    }

    const documents: NewDocument[] = [...picked.values()].map(hit => {
      const host = bareHost(hit.url)!;
      const page = pages.get(hit.url);
      const contentMd = page ?? [`# ${hit.title.trim()}`, "", hit.snippet.trim()].join("\n").trim();
      const postedAt = parseValidDate(hit.date ?? null);
      return {
        workspaceId: ctx.workspaceId, sourceId: ctx.sourceId, platform: hit.kind, urlCanonical: hit.url,
        authorRef: null, title: hit.title.trim().slice(0, 500), postedAt, contentMd,
        contentHash: contentHash(hit.kind, hit.url, contentMd),
        rawSnapshotRef: `${hit.provider}:${hit.url}`,
        metadata: { provider: hit.provider, mocked: false, venueKind: hit.kind, site: host, query: hit.query,
          reader: page ? (browserRead.has(hit.url) ? "cloudflare_browser_run" : "tinyfish_fetch") : null,
          contentKind: page ? "page_excerpt" : "preview", discoveryOnly: !page,
          publicationDateMissing: postedAt === null, partial: postedAt === null || !page },
      };
    });

    const reasons: string[] = [];
    if (failures.length) reasons.push(`${failures.length} of ${searches} searches failed (${[...new Set(failures)].join("; ")}).`);
    const snippetsOnly = documents.filter(d => !pages.has(d.urlCanonical)).length;
    if (snippetsOnly) reasons.push(`${snippetsOnly} result(s) are search snippets only; read the page before acting.`);
    const undated = documents.filter(d => d.postedAt === null).length;
    if (undated) reasons.push(`${undated} result(s) have no supplied publication date; recency is unverified.`);
    return { documents, partial: reasons.length > 0, coverageReason: reasons.join(" ") || undefined,
      nextState: { cursor: now.toISOString() } };
  },
};
