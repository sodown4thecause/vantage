import fixture from "@/test/fixtures/reddit.json";
import {
  asRecordArray,
  numberField,
  stringField,
} from "@/lib/tinyfish/agent";
import { createScavioClient, hasScavioApiKey } from "@/lib/scavio/client";

export type RedditPost = {
  id: string;
  title: string;
  body: string;
  url: string;
  author?: string;
  subreddit?: string;
  score: number;
  createdAt: string;
  numComments: number;
};

export type RedditFetchMeta = {
  provider: "scavio" | "fixture";
};

function fixturePosts(limit?: number): RedditPost[] {
  return (fixture.posts as RedditPost[]).slice(0, limit ?? 20);
}

function mapPosts(
  rows: Array<Record<string, unknown>>,
  limit: number,
): RedditPost[] {
  const out: RedditPost[] = [];
  for (const row of rows) {
    const id =
      stringField(row, "id", "post_id", "fullname", "name") ??
      `reddit-${out.length + 1}`;
    const title = stringField(row, "title", "name") ?? id;
    const url =
      stringField(row, "url", "permalink", "link", "full_link") ??
      (id.startsWith("t3_")
        ? `https://www.reddit.com/comments/${id.replace(/^t3_/, "")}`
        : `https://www.reddit.com/${id}`);
    const body =
      stringField(row, "body", "selftext", "text", "content", "snippet") ??
      title;
    out.push({
      id,
      title,
      body,
      url,
      author: stringField(row, "author", "author_name", "username", "user"),
      subreddit: stringField(row, "subreddit", "subreddit_name", "community"),
      score: numberField(row, "score", "ups", "upvotes", "votes") ?? 0,
      createdAt:
        stringField(row, "createdAt", "created_at", "created_utc", "date") ??
        new Date().toISOString(),
      numComments:
        numberField(row, "numComments", "num_comments", "comments", "comment_count") ??
        0,
    });
    if (out.length >= limit) break;
  }
  return out;
}

function unwrapResults(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  const direct = asRecordArray(payload, ["results", "posts", "items", "data"]);
  if (direct.length) return direct;
  const nested = payload.data;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return asRecordArray(nested as Record<string, unknown>, [
      "results",
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
}): Promise<{ posts: RedditPost[]; cursor?: string | null }> {
  const client = createScavioClient();
  const query = opts?.query?.trim() || "social listening indie saas";
  const limit = opts?.limit ?? 20;
  const payload = (await client.reddit.search({
    query,
    cursor: opts?.cursor,
  })) as Record<string, unknown>;

  const posts = mapPosts(unwrapResults(payload), limit);
  const nextCursor =
    stringField(payload, "next_cursor", "cursor") ??
    (payload.data && typeof payload.data === "object"
      ? stringField(payload.data as Record<string, unknown>, "next_cursor", "cursor")
      : undefined) ??
    null;

  return { posts, cursor: nextCursor };
}

/**
 * Reddit client (Scavio search). Arcade optional later — Scavio is enough.
 */
export async function fetchRedditPosts(opts?: {
  query?: string;
  limit?: number;
  cursor?: string;
}): Promise<RedditPost[]> {
  const { posts } = await fetchRedditPostsWithMeta(opts);
  return posts;
}

export async function fetchRedditPostsWithMeta(opts?: {
  query?: string;
  limit?: number;
  cursor?: string;
}): Promise<{
  posts: RedditPost[];
  meta: RedditFetchMeta;
  cursor?: string | null;
}> {
  if (hasScavioApiKey()) {
    try {
      const { posts, cursor } = await fetchViaScavio(opts);
      if (posts.length) {
        return { posts, meta: { provider: "scavio" }, cursor };
      }
    } catch (err) {
      console.warn(
        "[reddit] Scavio path failed; falling back to fixture",
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
