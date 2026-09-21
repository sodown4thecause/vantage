import fixture from "@/test/fixtures/x.json";
import {
  asRecordArray,
  numberField,
  stringField,
} from "@/lib/tinyfish/agent";
import { createScavioClient, hasScavioApiKey } from "@/lib/scavio/client";

export type XPost = {
  id: string;
  text: string;
  url: string;
  author?: string;
  createdAt: string;
  likeCount: number;
  repostCount: number;
  replyCount: number;
};

export type XFetchMeta = {
  provider: "scavio" | "fixture";
};

function fixturePosts(limit?: number): XPost[] {
  return (fixture.posts as XPost[]).slice(0, limit ?? 20);
}

function tweetUrl(id: string, author?: string): string {
  const handle = author?.replace(/^@/, "") || "i";
  return `https://x.com/${handle}/status/${id}`;
}

function mapPosts(
  rows: Array<Record<string, unknown>>,
  limit: number,
): XPost[] {
  const out: XPost[] = [];
  for (const row of rows) {
    const text = stringField(
      row,
      "text",
      "full_text",
      "content",
      "body",
      "tweet",
      "snippet",
    );
    if (!text) continue;
    const id =
      stringField(row, "id", "tweet_id", "status_id", "rest_id") ??
      `x-${out.length + 1}`;
    const author = stringField(
      row,
      "author",
      "username",
      "user",
      "screen_name",
      "handle",
    );
    const url =
      stringField(row, "url", "permalink", "link") ?? tweetUrl(id, author);
    out.push({
      id,
      text,
      url,
      author,
      createdAt:
        stringField(row, "createdAt", "created_at", "date", "timestamp") ??
        new Date().toISOString(),
      likeCount:
        numberField(row, "likeCount", "like_count", "likes", "favorite_count") ??
        0,
      repostCount:
        numberField(
          row,
          "repostCount",
          "repost_count",
          "retweet_count",
          "retweets",
        ) ?? 0,
      replyCount:
        numberField(row, "replyCount", "reply_count", "replies") ?? 0,
    });
    if (out.length >= limit) break;
  }
  return out;
}

function unwrapResults(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  const direct = asRecordArray(payload, [
    "results",
    "tweets",
    "posts",
    "items",
    "data",
  ]);
  if (direct.length) return direct;
  const nested = payload.data;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return asRecordArray(nested as Record<string, unknown>, [
      "results",
      "tweets",
      "posts",
      "items",
    ]);
  }
  return asRecordArray(payload);
}

async function fetchViaScavio(opts?: {
  query?: string;
  limit?: number;
  cursor?: string;
  searchType?: "Top" | "Latest" | "People" | "Photos" | "Videos";
}): Promise<{ posts: XPost[]; cursor?: string | null }> {
  const client = createScavioClient();
  const search = opts?.query?.trim() || "social listening OR brand monitoring";
  const limit = opts?.limit ?? 20;
  const payload = (await client.x.search({
    search,
    search_type: opts?.searchType ?? "Latest",
    cursor: opts?.cursor,
  })) as Record<string, unknown>;

  const posts = mapPosts(unwrapResults(payload), limit);
  const nextCursor =
    stringField(payload, "next_cursor", "cursor") ??
    (payload.data && typeof payload.data === "object"
      ? stringField(
          payload.data as Record<string, unknown>,
          "next_cursor",
          "cursor",
        )
      : undefined) ??
    null;

  return { posts, cursor: nextCursor };
}

/**
 * X (Twitter) client via Scavio search.
 * arcade-scavio curated toolkit omits X; Scavio SDK covers it directly.
 */
export async function fetchXPosts(opts?: {
  query?: string;
  limit?: number;
  cursor?: string;
  searchType?: "Top" | "Latest" | "People" | "Photos" | "Videos";
}): Promise<XPost[]> {
  const { posts } = await fetchXPostsWithMeta(opts);
  return posts;
}

export async function fetchXPostsWithMeta(opts?: {
  query?: string;
  limit?: number;
  cursor?: string;
  searchType?: "Top" | "Latest" | "People" | "Photos" | "Videos";
}): Promise<{ posts: XPost[]; meta: XFetchMeta; cursor?: string | null }> {
  if (hasScavioApiKey()) {
    try {
      const { posts, cursor } = await fetchViaScavio(opts);
      if (posts.length) {
        return { posts, meta: { provider: "scavio" }, cursor };
      }
    } catch (err) {
      console.warn(
        "[x] Scavio path failed; falling back to fixture",
        err instanceof Error ? err.message : err,
      );
    }
  }

  return {
    posts: fixturePosts(opts?.limit),
    meta: { provider: "fixture" },
    cursor: null,
  };
}
