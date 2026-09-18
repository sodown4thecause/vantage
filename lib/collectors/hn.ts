import { contentHash } from "@/lib/collectors/hash";
import type {
  Collector,
  CollectorContext,
  CollectorResult,
} from "@/lib/collectors/types";
import type { NewDocument } from "@/lib/db/schema";

const ALGOLIA = "https://hn.algolia.com/api/v1/search_by_date";
const FIREBASE = "https://hacker-news.firebaseio.com/v0/item";

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
): Promise<{ hits: AlgoliaHit[]; nbPages: number }> {
  const url = new URL(ALGOLIA);
  url.searchParams.set("query", query);
  url.searchParams.set("tags", "story");
  url.searchParams.set("hitsPerPage", "100");
  url.searchParams.set("page", String(page));
  url.searchParams.set("numericFilters", numericFilters);
  const res = await fetch(url, { next: { revalidate: 0 } });
  if (!res.ok) {
    throw new Error(`Algolia HN error ${res.status}`);
  }
  const data = (await res.json()) as {
    hits: AlgoliaHit[];
    nbPages?: number;
  };
  return { hits: data.hits ?? [], nbPages: data.nbPages ?? 1 };
}

async function enrichFirebase(id: string): Promise<{
  text?: string;
  url?: string;
  title?: string;
} | null> {
  try {
    const res = await fetch(`${FIREBASE}/${id}.json`, {
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    return (await res.json()) as { text?: string; url?: string; title?: string };
  } catch {
    return null;
  }
}

export const hnCollector: Collector = {
  name: "hn",
  async run(ctx: CollectorContext): Promise<CollectorResult> {
    const queries = queriesFromConfig(ctx.config);
    const lookbackHours = Number(ctx.config.lookbackHours ?? 24);
    const since =
      Number(ctx.cursor) ||
      Math.floor(Date.now() / 1000) - lookbackHours * 3600;
    const until = Math.floor(Date.now() / 1000);
    const numericFilters = `created_at_i>${since},created_at_i<=${until}`;

    const byId = new Map<string, AlgoliaHit>();

    // Algolia caps ~1000 hits/query — page until nbPages or hard cap.
    for (const q of queries) {
      let page = 0;
      let nbPages = 1;
      while (page < nbPages && page < 10) {
        const batch = await fetchAlgoliaPage(q, numericFilters, page);
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
      const fb = await enrichFirebase(hit.objectID);
      const title = fb?.title ?? hit.title ?? `(hn ${hit.objectID})`;
      const url =
        fb?.url ||
        hit.url ||
        `https://news.ycombinator.com/item?id=${hit.objectID}`;
      const body =
        fb?.text || hit.story_text || hit.comment_text || title || "";
      const postedAt = hit.created_at_i
        ? new Date(hit.created_at_i * 1000)
        : hit.created_at
          ? new Date(hit.created_at)
          : null;

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
