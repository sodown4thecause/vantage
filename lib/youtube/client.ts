import fixture from "@/test/fixtures/youtube.json";
import {
  asRecordArray,
  numberField,
  runTinyFishStructuredAgent,
  stringField,
} from "@/lib/tinyfish/agent";
import { hasTinyFishApiKey } from "@/lib/tinyfish/client";
import {
  tinyFishFetchMarkdown,
  tinyFishSearch,
} from "@/lib/tinyfish/search-fetch";
import { createScavioClient, hasScavioApiKey } from "@/lib/scavio/client";

export type YouTubeComment = {
  id: string;
  videoId: string;
  videoTitle: string;
  author: string;
  text: string;
  publishedAt: string;
  likeCount: number;
  videoUrl: string;
};

export type YouTubeFetchMeta = {
  provider:
    | "scavio"
    | "tinyfish_fetch"
    | "tinyfish_search_fetch"
    | "tinyfish_agent"
    | "youtube_api"
    | "fixture";
};

const COMMENT_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    comments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          videoId: { type: "string" },
          videoTitle: { type: "string" },
          author: { type: "string" },
          text: { type: "string" },
          publishedAt: { type: "string" },
          likeCount: { type: "number" },
          videoUrl: { type: "string" },
        },
        required: ["id", "videoId", "author", "text", "videoUrl"],
      },
    },
  },
  required: ["comments"],
} as const;

function fixtureComments(videoIds?: string[]): YouTubeComment[] {
  const all = fixture.comments as YouTubeComment[];
  if (videoIds?.length) {
    return all.filter((c) => videoIds.includes(c.videoId));
  }
  return all;
}

function videoUrlFor(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

function extractVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[\w-]{6,}$/.test(trimmed) && !trimmed.includes("://")) {
    return trimmed;
  }
  try {
    const url = new URL(trimmed);
    if (url.hostname.includes("youtu.be")) {
      return url.pathname.replace(/^\//, "") || null;
    }
    const v = url.searchParams.get("v");
    if (v) return v;
    const shorts = url.pathname.match(/\/(?:shorts|embed|live)\/([^/?#]+)/);
    if (shorts?.[1]) return shorts[1];
  } catch {
    return null;
  }
  return null;
}

function mapCommentRows(
  rows: Array<Record<string, unknown>>,
  fallbackVideoId?: string,
  fallbackTitle?: string,
): YouTubeComment[] {
  const out: YouTubeComment[] = [];
  for (const row of rows) {
    const text = stringField(
      row,
      "text",
      "comment",
      "body",
      "content",
      "contentText",
      "comment_text",
    );
    if (!text) continue;
    const videoUrl =
      stringField(row, "videoUrl", "url", "video_url") ??
      (fallbackVideoId ? videoUrlFor(fallbackVideoId) : undefined);
    const videoId =
      stringField(row, "videoId", "video_id") ??
      (videoUrl ? extractVideoId(videoUrl) : null) ??
      fallbackVideoId ??
      "unknown";
    const id =
      stringField(row, "id", "commentId", "comment_id", "cid") ??
      `yt-${videoId}-${out.length + 1}`;
    out.push({
      id,
      videoId,
      videoTitle:
        stringField(row, "videoTitle", "video_title", "title") ??
        fallbackTitle ??
        videoId,
      author:
        stringField(
          row,
          "author",
          "authorDisplayName",
          "author_name",
          "user",
          "username",
        ) ?? "unknown",
      text,
      publishedAt:
        stringField(
          row,
          "publishedAt",
          "published_at",
          "createdAt",
          "created_at",
          "time",
        ) ?? new Date().toISOString(),
      likeCount:
        numberField(row, "likeCount", "like_count", "likes", "vote_count") ??
        0,
      videoUrl: videoUrl ?? videoUrlFor(videoId),
    });
  }
  return out;
}

function mapTinyFishComments(
  payload: Record<string, unknown>,
  fallbackVideoId?: string,
): YouTubeComment[] {
  return mapCommentRows(
    asRecordArray(payload, ["comments", "items", "results", "data"]),
    fallbackVideoId,
  );
}

function commentsFromMarkdown(
  pageText: string,
  videoId: string,
  videoTitle?: string,
): YouTubeComment[] {
  // Best-effort parse of comment-like lines from fetched markdown.
  const lines = pageText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const out: YouTubeComment[] = [];
  for (const line of lines) {
    if (line.length < 24) continue;
    if (/^#+\s/.test(line)) continue;
    if (/subscribe|sign in|cookie|privacy/i.test(line)) continue;
    // Prefer lines that look like user comments rather than chrome.
    if (!/[.!?]$/.test(line) && line.split(/\s+/).length < 8) continue;
    out.push({
      id: `yt-md-${videoId}-${out.length + 1}`,
      videoId,
      videoTitle: videoTitle ?? videoId,
      author: "unknown",
      text: line.replace(/^[-*•]\s+/, "").slice(0, 2000),
      publishedAt: new Date().toISOString(),
      likeCount: 0,
      videoUrl: videoUrlFor(videoId),
    });
    if (out.length >= 30) break;
  }
  return out;
}

async function fetchViaScavio(opts?: {
  videoIds?: string[];
}): Promise<YouTubeComment[]> {
  const client = createScavioClient();
  const seeds =
    opts?.videoIds?.length
      ? opts.videoIds
      : [...new Set(fixtureComments().map((c) => c.videoId))];

  const out: YouTubeComment[] = [];
  for (const videoId of seeds) {
    const payload = (await client.youtube.comments({
      video_id: videoId,
    })) as Record<string, unknown>;
    const rows = asRecordArray(payload, [
      "comments",
      "items",
      "results",
      "data",
    ]);
    // Some scrapers nest under data.comments
    const nested =
      rows.length > 0
        ? rows
        : asRecordArray(
            (payload.data as Record<string, unknown> | undefined) ?? {},
            ["comments", "items", "results"],
          );
    const mapped = mapCommentRows(
      nested.length ? nested : asRecordArray(payload),
      videoId,
    );
    if (mapped.length === 0 && nested.length === 0) {
      // Try flattening if payload itself is list-like under unknown keys
      for (const value of Object.values(payload)) {
        const maybe = asRecordArray(value);
        if (maybe.length) {
          out.push(...mapCommentRows(maybe, videoId));
          break;
        }
      }
    } else {
      out.push(...mapped);
    }
  }
  return out;
}

async function fetchViaTinyFishFetch(opts?: {
  videoIds?: string[];
}): Promise<YouTubeComment[]> {
  const seeds =
    opts?.videoIds?.length
      ? opts.videoIds
      : [...new Set(fixtureComments().map((c) => c.videoId))];
  const urls = seeds.map(videoUrlFor);
  const pages = await tinyFishFetchMarkdown(urls, {
    purpose:
      "Extract public top-level YouTube comments with author and comment text.",
    highlightQuery: "viewer comments discussion replies feedback",
  });

  const out: YouTubeComment[] = [];
  for (const page of pages) {
    const videoId =
      extractVideoId(page.finalUrl ?? page.url) ??
      seeds.find((id) => (page.finalUrl ?? page.url).includes(id)) ??
      "unknown";
    // Prefer highlight snippets as comment candidates.
    const fromHighlights = page.highlights
      .filter((h) => h.trim().length > 20)
      .map((h, i) => ({
        id: `yt-hl-${videoId}-${i + 1}`,
        videoId,
        videoTitle: page.title ?? videoId,
        author: "unknown",
        text: h.slice(0, 2000),
        publishedAt: new Date().toISOString(),
        likeCount: 0,
        videoUrl: videoUrlFor(videoId),
      }));
    if (fromHighlights.length) {
      out.push(...fromHighlights);
      continue;
    }
    out.push(
      ...commentsFromMarkdown(page.text, videoId, page.title ?? undefined),
    );
  }
  return out;
}

async function fetchViaTinyFishSearchFetch(opts?: {
  videoIds?: string[];
  query?: string;
}): Promise<YouTubeComment[]> {
  // Discovery path when no explicit video IDs — search then fetch.
  if (opts?.videoIds?.length) {
    return fetchViaTinyFishFetch(opts);
  }
  const query =
    opts?.query?.trim() ||
    "site:youtube.com/watch social listening indie hackers comments";
  const hits = await tinyFishSearch(query, {
    includeDomains: ["youtube.com", "youtu.be"],
    purpose: "Find YouTube videos relevant to social listening / SaaS demand.",
  });
  const videoIds = [
    ...new Set(
      hits
        .map((h) => extractVideoId(h.url))
        .filter((id): id is string => Boolean(id)),
    ),
  ].slice(0, 5);
  if (!videoIds.length) return [];
  return fetchViaTinyFishFetch({ videoIds });
}

async function fetchViaTinyFishAgent(opts?: {
  videoIds?: string[];
}): Promise<YouTubeComment[]> {
  const seeds =
    opts?.videoIds?.length
      ? opts.videoIds
      : [...new Set(fixtureComments().map((c) => c.videoId))];
  const collected: YouTubeComment[] = [];
  for (const videoId of seeds) {
    const url = videoUrlFor(videoId);
    const result = await runTinyFishStructuredAgent({
      url,
      browserProfile: "lite",
      goal: [
        `Open the YouTube video at ${url}.`,
        "Extract top-level public comments only (no replies).",
        "Prefer recent or high-engagement comments, up to 50.",
        "Do not invent comments. Empty array if blocked.",
      ].join("\n"),
      outputSchema: COMMENT_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
    });
    collected.push(...mapTinyFishComments(result, videoId));
  }
  return collected;
}

async function fetchViaYouTubeApi(opts?: {
  videoIds?: string[];
}): Promise<YouTubeComment[]> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error("YOUTUBE_API_KEY is not configured");

  const videoIds =
    opts?.videoIds?.length
      ? opts.videoIds
      : [...new Set(fixtureComments().map((c) => c.videoId))];

  const out: YouTubeComment[] = [];
  for (const videoId of videoIds) {
    const url = new URL("https://www.googleapis.com/youtube/v3/commentThreads");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("videoId", videoId);
    url.searchParams.set("maxResults", "50");
    url.searchParams.set("textFormat", "plainText");
    url.searchParams.set("key", key);
    const res = await fetch(url, { next: { revalidate: 0 } });
    if (!res.ok) {
      throw new Error(`YouTube API ${res.status} for video ${videoId}`);
    }
    const json = (await res.json()) as {
      items?: Array<{
        id: string;
        snippet?: {
          topLevelComment?: {
            snippet?: {
              authorDisplayName?: string;
              textDisplay?: string;
              publishedAt?: string;
              likeCount?: number;
            };
          };
        };
      }>;
    };
    for (const item of json.items ?? []) {
      const sn = item.snippet?.topLevelComment?.snippet;
      if (!sn?.textDisplay) continue;
      out.push({
        id: item.id,
        videoId,
        videoTitle: videoId,
        author: sn.authorDisplayName ?? "unknown",
        text: sn.textDisplay,
        publishedAt: sn.publishedAt ?? new Date().toISOString(),
        likeCount: sn.likeCount ?? 0,
        videoUrl: videoUrlFor(videoId),
      });
    }
  }
  return out;
}

/**
 * YouTube comments client.
 * Prefer structured scrape / search+fetch over full browser agents.
 *
 * Order:
 * 1. Scavio YouTube comments API (SCAVIO_API_KEY)
 * 2. TinyFish Fetch (and Search→Fetch when discovering videos)
 * 3. TinyFish Agent (last resort)
 * 4. YouTube Data API
 * 5. Fixtures
 */
export async function fetchYouTubeComments(opts?: {
  videoIds?: string[];
  query?: string;
}): Promise<YouTubeComment[]> {
  const { comments } = await fetchYouTubeCommentsWithMeta(opts);
  return comments;
}

export async function fetchYouTubeCommentsWithMeta(opts?: {
  videoIds?: string[];
  query?: string;
}): Promise<{ comments: YouTubeComment[]; meta: YouTubeFetchMeta }> {
  const tryPath = async (
    provider: YouTubeFetchMeta["provider"],
    fn: () => Promise<YouTubeComment[]>,
  ): Promise<{ comments: YouTubeComment[]; meta: YouTubeFetchMeta } | null> => {
    try {
      const comments = await fn();
      if (comments.length === 0) return null;
      return { comments, meta: { provider } };
    } catch (err) {
      console.warn(
        `[youtube] ${provider} failed; trying next path`,
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  };

  if (hasScavioApiKey() && (opts?.videoIds?.length || !opts?.query)) {
    const hit = await tryPath("scavio", () => fetchViaScavio(opts));
    if (hit) return hit;
  }

  if (hasTinyFishApiKey()) {
    if (opts?.videoIds?.length) {
      const fetchHit = await tryPath("tinyfish_fetch", () =>
        fetchViaTinyFishFetch(opts),
      );
      if (fetchHit) return fetchHit;
    } else {
      const searchHit = await tryPath("tinyfish_search_fetch", () =>
        fetchViaTinyFishSearchFetch(opts),
      );
      if (searchHit) return searchHit;
    }

    const agentHit = await tryPath("tinyfish_agent", () =>
      fetchViaTinyFishAgent(opts),
    );
    if (agentHit) return agentHit;
  }

  if (process.env.YOUTUBE_API_KEY?.trim()) {
    const comments = await fetchViaYouTubeApi(opts);
    return { comments, meta: { provider: "youtube_api" } };
  }

  return {
    comments: fixtureComments(opts?.videoIds),
    meta: { provider: "fixture" },
  };
}
