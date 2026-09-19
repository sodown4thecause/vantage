import { contentHash } from "@/lib/collectors/hash";
import type { Collector, CollectorContext, CollectorResult } from "@/lib/collectors/types";
import type { NewDocument } from "@/lib/db/schema";

const ALGOLIA = "https://hn.algolia.com/api/v1/search_by_date";
const FIREBASE = "https://hacker-news.firebaseio.com/v0/item";
const ALGOLIA_MAX_HITS = 1_000;
const ALGOLIA_HITS_PER_PAGE = 100;

type AlgoliaHit = {
  objectID: string;
  title?: string;
  author?: string;
};

type AlgoliaResponse = {
  hits: AlgoliaHit[];
  nbHits: number;
  nbPages: number;
};

type FirebaseStory = {
  id: number;
  type: "story";
  by?: string;
  time: number;
  title: string;
  text?: string;
  url?: string;
};

function queriesFromConfig(config: Record<string, unknown>): string[] {
  if (!Array.isArray(config.queries)) {
    throw new Error("HN collector requires config.queries");
  }

  if (
    !config.queries.length ||
    config.queries.some(
      (query) => typeof query !== "string" || !query.trim(),
    )
  ) {
    throw new Error(
      "HN collector requires config.queries to contain only non-empty strings",
    );
  }

  return config.queries.map((query) => query.trim());
}

async function fetchAlgoliaPage(
  query: string,
  start: number,
  end: number,
  page: number,
): Promise<Required<AlgoliaResponse>> {
  const url = new URL(ALGOLIA);
  url.searchParams.set("query", query);
  url.searchParams.set("tags", "story");
  url.searchParams.set("hitsPerPage", String(ALGOLIA_HITS_PER_PAGE));
  url.searchParams.set("page", String(page));
  url.searchParams.set(
    "numericFilters",
    `created_at_i>=${start},created_at_i<=${end}`,
  );

  const response = await fetch(url, { next: { revalidate: 0 } });
  if (!response.ok) {
    throw new Error(`Algolia HN error ${response.status}`);
  }

  const data = (await response.json()) as unknown;
  if (!isAlgoliaResponse(data)) {
    throw new Error("Invalid Algolia HN response");
  }
  return data;
}

function isAlgoliaResponse(data: unknown): data is AlgoliaResponse {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return false;
  }

  const candidate = data as Record<string, unknown>;
  return Boolean(
    Array.isArray(candidate.hits) &&
      candidate.hits.every(
        (hit) =>
          Boolean(hit) &&
          typeof hit === "object" &&
          !Array.isArray(hit) &&
          typeof (hit as Record<string, unknown>).objectID === "string",
      ) &&
      typeof candidate.nbHits === "number" &&
      Number.isSafeInteger(candidate.nbHits) &&
      candidate.nbHits >= 0 &&
      typeof candidate.nbPages === "number" &&
      Number.isSafeInteger(candidate.nbPages) &&
      candidate.nbPages >= 0 &&
      (candidate.nbHits === 0 ? candidate.nbPages === 0 : candidate.nbPages > 0),
  );
}

async function fetchAlgoliaRange(
  query: string,
  start: number,
  end: number,
): Promise<AlgoliaHit[]> {
  const firstPage = await fetchAlgoliaPage(query, start, end, 0);
  const isAtCap =
    firstPage.nbHits >= ALGOLIA_MAX_HITS || firstPage.nbPages >= 10;

  if (isAtCap && start === end) {
    throw new Error("Algolia HN range saturated at one-second resolution");
  }

  if (isAtCap) {
    const midpoint = Math.floor((start + end) / 2);
    const earlier = await fetchAlgoliaRange(query, start, midpoint);
    const later = await fetchAlgoliaRange(query, midpoint + 1, end);
    return [...earlier, ...later];
  }

  const hits = [...firstPage.hits];
  const pageCount = Math.min(firstPage.nbPages, 10);
  for (let page = 1; page < pageCount; page += 1) {
    const nextPage = await fetchAlgoliaPage(query, start, end, page);
    hits.push(...nextPage.hits);
  }
  return hits;
}

function isFirebaseStory(item: unknown): item is FirebaseStory {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return false;
  }

  const candidate = item as Record<string, unknown>;
  return Boolean(
    candidate.deleted !== true &&
      candidate.dead !== true &&
      (candidate.deleted === undefined || typeof candidate.deleted === "boolean") &&
      (candidate.dead === undefined || typeof candidate.dead === "boolean") &&
      candidate.type === "story" &&
      typeof candidate.id === "number" &&
      Number.isSafeInteger(candidate.id) &&
      candidate.id > 0 &&
      typeof candidate.time === "number" &&
      Number.isSafeInteger(candidate.time) &&
      candidate.time > 0 &&
      typeof candidate.title === "string" &&
      candidate.title.trim() &&
      (candidate.by === undefined || typeof candidate.by === "string") &&
      (candidate.text === undefined || typeof candidate.text === "string") &&
      (candidate.url === undefined || typeof candidate.url === "string"),
  );
}

async function fetchFirebaseStory(id: string): Promise<FirebaseStory | null> {
  const response = await fetch(`${FIREBASE}/${id}.json`, {
    next: { revalidate: 0 },
  });
  if (!response.ok) {
    throw new Error(`Firebase HN error ${response.status}`);
  }

  const data = (await response.json()) as unknown;
  return isFirebaseStory(data) && data.id === Number(id) ? data : null;
}

function contentFromStory(story: FirebaseStory): string {
  const title = story.title.trim();
  const body = story.text
    ?.replace(/<br\s*\/?>(\r?\n)?/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .trim();
  return body ? `# ${title}\n\n${body}` : `# ${title}`;
}

function canonicalUrl(id: string, url: string | undefined): string {
  if (url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.toString();
      }
    } catch {
      // An invalid external URL falls back to the durable HN item URL.
    }
  }
  return `https://news.ycombinator.com/item?id=${id}`;
}

function cursorStart(cursor: string | null | undefined, now: number): number {
  if (cursor === null || cursor === undefined || !cursor.trim()) {
    return now - 24 * 60 * 60;
  }

  const parsed = Number(cursor);
  if (Number.isInteger(parsed) && parsed >= 0 && parsed <= now) {
    return parsed;
  }
  return now - 24 * 60 * 60;
}

export const hnCollector: Collector = {
  name: "hn",
  async run(ctx: CollectorContext): Promise<CollectorResult> {
    const now = Math.floor(Date.now() / 1_000);
    const start = cursorStart(ctx.cursor, now);
    const hitsById = new Map<string, AlgoliaHit>();

    for (const query of queriesFromConfig(ctx.config)) {
      for (const hit of await fetchAlgoliaRange(query, start, now)) {
        if (hit.objectID) hitsById.set(hit.objectID, hit);
      }
    }

    const documents: NewDocument[] = [];
    for (const [id, hit] of hitsById) {
      const story = await fetchFirebaseStory(id);
      if (!story) continue;

      const postedAt = new Date(story.time * 1_000);
      if (!Number.isFinite(postedAt.getTime())) continue;

      const urlCanonical = canonicalUrl(id, story.url);
      const contentMd = contentFromStory(story);
      documents.push({
        workspaceId: ctx.workspaceId,
        sourceId: ctx.sourceId,
        urlCanonical,
        platform: "hn",
        authorRef: story.by ?? hit.author ?? null,
        title: story.title.trim(),
        postedAt,
        contentMd,
        contentHash: contentHash("hn", urlCanonical, contentMd),
        rawSnapshotRef: `hn:${id}`,
        metadata: { objectID: id, querySource: "algolia" },
      });
    }

    return { documents, nextState: { cursor: String(now) } };
  },
};
