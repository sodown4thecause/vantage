import { and, count, eq, gte, sql } from "drizzle-orm";

import {
  costEvent,
  document,
  linkEnrichment,
  type DocumentRecord,
} from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import { mapWithConcurrency } from "@/lib/async/map-with-concurrency";
import { fetchLinkedPage, fetchYoutubeTranscript } from "@/lib/enrich/scrape";
import { summariserAvailable, summariseLinkedPage } from "@/lib/enrich/summarise";
import {
  candidateLinkUrls,
  isSkippedHost,
  normaliseLinkedUrl,
  type LinkedKind,
} from "@/lib/enrich/url";
import { isPaidCallDenied, runPaidCall } from "@/lib/providers/paid-call";

/** A short post whose linked page was summarised; stored on the document's metadata. */
export type LinkedContext = {
  url: string;
  kind: LinkedKind;
  title: string | null;
  summary: string;
};

/** Body length at or under which a post counts as a link post. */
export const LINK_POST_MAX_CHARS = 100;
/** A cached `ok` row younger than this means no fetch. */
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** A failed row waits this long before its next try, and gets at most two tries. */
const RETRY_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 2;
const ENRICH_CONCURRENCY = 3;
/** runPaidCall estimates, refined by actual usage where the provider reports it. */
const FIRECRAWL_SCRAPE_ESTIMATE_USD = 0.001;
const SUPADATA_TRANSCRIPT_ESTIMATE_USD = 0.005;

/** ENRICH_DAILY_MAX: enrichments per workspace per day; 0 turns enrichment off. Default 20. */
export function enrichDailyMax(env: Record<string, string | undefined> = process.env): number {
  if (!env.ENRICH_DAILY_MAX?.trim()) return 20;
  const raw = Number(env.ENRICH_DAILY_MAX);
  if (!Number.isFinite(raw)) return 20;
  return Math.max(0, Math.floor(raw));
}

/**
 * The author's own text: contentMd minus the title the collectors copy into it
 * (HN falls back to the title; Reddit prefixes "r/sub", "u/user" and "# title").
 */
function ownBodyLength(doc: Pick<DocumentRecord, "title" | "contentMd">): number {
  let body = doc.contentMd ?? "";
  const title = (doc.title ?? "").trim();
  if (title) {
    const at = body.indexOf(title);
    if (at >= 0) body = body.slice(0, at) + body.slice(at + title.length);
  }
  return body.replace(/^\s*(?:r\/\S+|u\/\S+|#)\s*$/gm, "").trim().length;
}

function isLinkPost(doc: Pick<DocumentRecord, "title" | "contentMd">): boolean {
  const hasContent = (doc.title ?? "").trim().length > 0 || (doc.contentMd ?? "").trim().length > 0;
  return hasContent && ownBodyLength(doc) < LINK_POST_MAX_CHARS;
}

/** Firecrawl charges per credit; the conversion env keeps the meter honest when it is set. */
function firecrawlCreditUsd(): number {
  const n = Number(process.env.FIRECRAWL_CREDIT_USD);
  return Number.isFinite(n) && n > 0 ? n : FIRECRAWL_SCRAPE_ESTIMATE_USD;
}

/** Enrichments this workspace has already spent today (UTC), counted from the ledger. */
async function enrichmentsUsedToday(workspaceId: string): Promise<number> {
  const startOfDay = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  try {
    const rows = await getDb()
      .select({ n: count() })
      .from(costEvent)
      .where(and(
        eq(costEvent.workspaceId, workspaceId),
        eq(costEvent.action, "link_enrich"),
        gte(costEvent.ts, startOfDay),
      ));
    return Number(rows[0]?.n ?? 0);
  } catch {
    // Unreadable ledger: treat the budget as spent rather than overspend on a broken count.
    return Number.MAX_SAFE_INTEGER;
  }
}

type CacheDecision =
  | { action: "use"; row: { title: string | null; summary: string } }
  | { action: "skip" }
  | { action: "fetch"; priorAttempts: number };

/** 30-day freshness for hits; failed rows retry after 24 hours, at most two tries. */
export function decideFromCache(
  row: { status: "ok" | "skipped" | "failed"; title: string | null; summary: string | null; fetchedAt: Date | null; attempts: number; lastAttemptAt: Date } | null,
  now = new Date(),
): CacheDecision {
  if (!row) return { action: "fetch", priorAttempts: 0 };
  if (row.status === "ok") {
    return row.fetchedAt !== null && now.getTime() - row.fetchedAt.getTime() < CACHE_TTL_MS
      ? { action: "use", row: { title: row.title, summary: row.summary ?? "" } }
      : { action: "fetch", priorAttempts: 0 };
  }
  if (row.status === "skipped") return { action: "skip" };
  if (row.attempts >= MAX_ATTEMPTS) return { action: "skip" };
  if (now.getTime() - row.lastAttemptAt.getTime() < RETRY_AFTER_MS) return { action: "skip" };
  return { action: "fetch", priorAttempts: row.attempts };
}

/**
 * Summaries for the link posts among `docs`, keyed by document id. Only posts
 * whose body is under 100 characters and that carry an outbound URL are
 * enriched; each URL is fetched once per 30 days and every failure is quiet.
 */
export async function enrichLinkDocuments(
  docs: DocumentRecord[],
  opts: { workspaceId: string; signal?: AbortSignal },
): Promise<Map<string, LinkedContext>> {
  const out = new Map<string, LinkedContext>();
  const max = enrichDailyMax();
  if (max === 0) return out;
  const candidates = docs.filter(isLinkPost);
  if (candidates.length === 0) return out;
  let budgetLeft: number;
  try {
    budgetLeft = max - (await enrichmentsUsedToday(opts.workspaceId));
  } catch {
    return out;
  }
  const db = getDb();

  type Resolved = { title: string | null; summary: string } | null;
  // Documents linking to the same URL share one pending resolution, so the paid
  // fetch, the summary, the daily slot and the attempt are spent once per URL.
  const pending = new Map<string, Promise<Resolved>>();

  const resolveLink = async (link: { url: string; urlHash: string; kind: LinkedKind }): Promise<Resolved> => {
      const [row] = await db
        .select()
        .from(linkEnrichment)
        .where(eq(linkEnrichment.urlHash, link.urlHash))
        .limit(1);
      const decision = decideFromCache(row ?? null);
      if (decision.action === "skip") return null;
      if (decision.action === "use") return decision.row;

      const key = link.kind === "youtube" ? process.env.SUPADATA_API_KEY : process.env.FIRECRAWL_API_KEY;
      // Without a summariser the fetched text would be thrown away, so do not pay for it.
      if (!key?.trim() || !summariserAvailable() || budgetLeft <= 0) return null;
      budgetLeft -= 1;
      let fetched = await fetchLink(link, opts);
      const attempts = decision.priorAttempts + 1;
      if (fetched.outcome === "ok") {
        let budgetDenied = false;
        const summary = await summariseLinkedPage({
          url: link.url, title: fetched.value.title, text: fetched.value.text,
          workspaceId: opts.workspaceId, signal: opts.signal,
        }).catch((err) => {
          if (isPaidCallDenied(err)) budgetDenied = true;
          return null;
        });
        // A budget denial is not the page's fault: leave the row alone so a later run retries.
        if (budgetDenied) return null;
        if (summary) {
          await db
            .insert(linkEnrichment)
            .values({
              urlHash: link.urlHash, url: link.url, kind: link.kind,
              title: fetched.value.title, summary: summary.summary, status: "ok",
              attempts, lastAttemptAt: new Date(), fetchedAt: new Date(),
              costUsd: summary.costUsd !== undefined ? summary.costUsd.toFixed(6) : "0",
            })
            .onConflictDoUpdate({
              target: linkEnrichment.urlHash,
              set: {
                title: fetched.value.title, summary: summary.summary, status: "ok",
                attempts, lastAttemptAt: new Date(), fetchedAt: new Date(),
                costUsd: summary.costUsd !== undefined ? summary.costUsd.toFixed(6) : "0",
              },
            });
          return { title: fetched.value.title, summary: summary.summary };
        }
        fetched = { outcome: "failed", reason: "summary unavailable" };
      }

      // skipped: paywall, unsupported or empty — cached so it is never retried.
      // failed: transient — cached with the attempt count for the 24-hour retry.
      const status = fetched.outcome === "skipped" ? "skipped" : "failed";
      await db
        .insert(linkEnrichment)
        .values({
          urlHash: link.urlHash, url: link.url, kind: link.kind,
          title: null, summary: null, status, attempts,
          lastAttemptAt: new Date(),
          fetchedAt: null,
          costUsd: "0",
        })
        .onConflictDoUpdate({
          target: linkEnrichment.urlHash,
          set: { status, attempts, lastAttemptAt: new Date() },
        });
      return null;
  };

  await mapWithConcurrency(candidates, ENRICH_CONCURRENCY, async (doc) => {
    try {
      const link = firstEnrichableLink(doc);
      if (!link) return;
      let work = pending.get(link.urlHash);
      if (!work) {
        work = resolveLink(link);
        pending.set(link.urlHash, work);
      }
      const hit = await work;
      if (hit) out.set(doc.id, { url: link.url, kind: link.kind, title: hit.title, summary: hit.summary });
    } catch (err) {
      // A cap hit or a provider error scores without enrichment; the scan never fails here.
      if (opts.signal?.aborted) return;
      if (!isPaidCallDenied(err)) console.error("[enrich] link enrichment skipped:", err instanceof Error ? err.message : "unknown error");
    }
  });
  return out;
}

/** The first candidate URL that is enrichable on a link post, or null. */
export function firstEnrichableLink(doc: Pick<DocumentRecord, "urlCanonical" | "title" | "contentMd"> & Partial<Pick<DocumentRecord, "metadata">>): { url: string; urlHash: string; kind: LinkedKind } | null {
  if (!isLinkPost(doc)) return null;
  for (const candidate of candidateLinkUrls(doc)) {
    if (isSkippedHost(candidate)) continue;
    const link = normaliseLinkedUrl(candidate);
    if (link) return link;
  }
  return null;
}

/** One paid fetch: Supadata for YouTube, Firecrawl for everything else. */
async function fetchLink(
  link: { url: string; urlHash: string; kind: LinkedKind },
  opts: { workspaceId: string; signal?: AbortSignal },
): Promise<{ outcome: "ok"; value: { title: string | null; text: string } } | { outcome: "skipped" | "failed"; reason: string }> {
  const meta = {
    context: { workspaceId: opts.workspaceId, sourceKey: "link-enrich" },
    action: "link_enrich",
    signal: opts.signal,
  };
  if (link.kind === "youtube") {
    return runPaidCall({ ...meta, provider: "supadata", estimateUsd: SUPADATA_TRANSCRIPT_ESTIMATE_USD },
      async () => ({ value: await fetchYoutubeTranscript(link.url, { signal: opts.signal }) }));
  }
  return runPaidCall({ ...meta, provider: "firecrawl", estimateUsd: firecrawlCreditUsd() },
    async () => ({ value: await fetchLinkedPage(link.url, { signal: opts.signal }) }));
}

/** Persists a summary onto the document so later scans and the UI can read it. */
export async function attachLinkedContext(
  docIds: string[],
  linked: Map<string, LinkedContext>,
  workspaceId: string,
): Promise<void> {
  if (linked.size === 0) return;
  const db = getDb();
  for (const docId of docIds) {
    const context = linked.get(docId);
    if (!context) continue;
    try {
      const [row] = await db
        .select({ metadata: document.metadata })
        .from(document)
        .where(and(eq(document.id, docId), eq(document.workspaceId, workspaceId)))
        .limit(1);
      if (!row) continue;
      await db
        .update(document)
        .set({ metadata: { ...row.metadata, linkedContext: context } })
        .where(and(eq(document.id, docId), eq(document.workspaceId, workspaceId)));
    } catch {
      // Best effort: scoring falls back to the unenriched text.
    }
  }
}
