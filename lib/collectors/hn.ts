import { contentHash } from "@/lib/collectors/hash";
import { parseValidDate } from "@/lib/collectors/date";
import type {
  Collector,
  CollectorContext,
  CollectorResult,
} from "@/lib/collectors/types";
import type { NewDocument } from "@/lib/db/schema";

const ALGOLIA = "https://hn.algolia.com/api/v1/search_by_date";

type AlgoliaHit = {
  objectID: string;
  title?: string;
  url?: string | null;
  story_text?: string | null;
  comment_text?: string | null;
  author?: string;
  created_at_i?: number;
  created_at?: string;
};

function queriesFromConfig(config: Record<string, unknown>): string[] {
  if (Array.isArray(config.queries)) {
    return config.queries.map(String).filter(Boolean);
  }
  if (typeof config.query === "string" && config.query.trim()) {
    return [config.query.trim()];
  }
  return ["Show HN"];
}

async function fetchAlgoliaPage(
  query: string,
  numericFilters: string,
  page: number,
  signal?: AbortSignal,
): Promise<{ hits: AlgoliaHit[]; nbPages: number }> {
  const url = new URL(ALGOLIA);
  url.searchParams.set("query", query);
  url.searchParams.set("tags", "story");
  url.searchParams.set("hitsPerPage", "20");
  url.searchParams.set("page", String(page));
  url.searchParams.set("numericFilters", numericFilters);
  const res = await fetch(url, { next: { revalidate: 0 }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(4_000)]) : AbortSignal.timeout(4_000) });
  if (!res.ok) {
    throw new Error(`Algolia HN error ${res.status}`);
  }
  const data = (await res.json()) as {
    hits: AlgoliaHit[];
    nbPages?: number;
  };
  return { hits: data.hits ?? [], nbPages: data.nbPages ?? 1 };
}

export const hnCollector: Collector = {
  name: "hn",
  async run(ctx: CollectorContext): Promise<CollectorResult> {
    ctx.signal?.throwIfAborted();
    const queries = queriesFromConfig(ctx.config).slice(0, 5);
    const maxPages = Math.min(2, Math.max(1, Math.floor(Number(ctx.config.maxPages) || 1)));
    const lookbackHours = Number(ctx.config.lookbackHours ?? 24);
    const since =
      Number(ctx.cursor) ||
      Math.floor(Date.now() / 1000) - lookbackHours * 3600;
    const until = Math.floor(Date.now() / 1000);
    const numericFilters = `created_at_i>${since},created_at_i<=${until}`;

    const byId = new Map<string, AlgoliaHit>();

    // ponytail: sample at most two pages across five queries; use a backfill job for history.
    for (const q of queries) {
      let page = 0;
      let nbPages = 1;
      while (page < nbPages && page < maxPages) {
        ctx.signal?.throwIfAborted();
        const batch = await fetchAlgoliaPage(q, numericFilters, page, ctx.signal);
        nbPages = batch.nbPages;
        for (const hit of batch.hits) {
          if (hit.objectID) byId.set(hit.objectID, hit);
        }
        page += 1;
        if (batch.hits.length === 0) break;
      }
    }

    const documents: NewDocument[] = [];
    for (const hit of byId.values()) {
      const title = hit.title ?? `(hn ${hit.objectID})`;
      const url =
        hit.url ||
        `https://news.ycombinator.com/item?id=${hit.objectID}`;
      const body =
        hit.story_text || hit.comment_text || title || "";
      const postedAt = parseValidDate(
        hit.created_at_i ? hit.created_at_i * 1000 : hit.created_at,
      );

      documents.push({
        workspaceId: ctx.workspaceId,
        sourceId: ctx.sourceId,
        urlCanonical: url,
        platform: "hn",
        authorRef: hit.author ?? null,
        title,
        postedAt,
        contentMd: body,
        contentHash: contentHash("hn", url, body),
        rawSnapshotRef: `hn:${hit.objectID}`,
        metadata: { objectID: hit.objectID, querySource: "algolia" },
      });
    }

    return {
      documents,
      nextState: { cursor: String(until) },
    };
  },
};
