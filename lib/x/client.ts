import fixture from "@/test/fixtures/x.json";
import type { CostContext } from "@/lib/costs/meter";
import { isPaidCallDenied, runPaidCall } from "@/lib/providers/paid-call";
import { createScavioClient, hasScavioApiKey } from "@/lib/scavio/client";
import { asRecordArray, numberField, stringField } from "@/lib/tinyfish/agent";
import { analyzeXPostSignificance } from "@/lib/x/gateway";

export type XPost = {
  id: string; text: string; url: string; author?: string; createdAt: string;
  likeCount: number; repostCount: number; replyCount: number;
  significance?: { score: number; reason: string };
};
export type XFetchMeta = {
  provider: "scavio" | "fixture";
  gatewayMode?: "scavio_significance";
  gatewayStatus?: "completed" | "access_pending" | "failed";
  significanceModel?: string;
};
type XOptions = {
  query?: string; limit?: number; cursor?: string;
  searchType?: "Top" | "Latest" | "People" | "Photos" | "Videos";
  ctx?: CostContext; signal?: AbortSignal;
};
const X_PROVIDER_SHAPE_ERROR = "X provider unavailable: response shape invalid";

function postLink(value: string): { url: string; id: string; author: string } | undefined {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port
      || !["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(url.hostname)) return;
    const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)(?:\/|$)/);
    if (!match || match[1] === "i" || match[1] === "intent") return;
    return { url: `https://x.com/${match[1]}/status/${match[2]}`, author: match[1], id: match[2] };
  } catch { return; }
}

function mapPosts(rows: Array<Record<string, unknown>>, limit: number): XPost[] {
  const posts: XPost[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const text = [row.text, row.full_text, row.tweet].find((value): value is string => typeof value === "string" && Boolean(value.trim()));
    const suppliedId = stringField(row, "id", "tweet_id", "status_id", "rest_id");
    const author = stringField(row, "author", "username", "screen_name", "handle")?.replace(/^@/, "");
    const suppliedUrl = stringField(row, "url", "permalink", "link");
    const link = suppliedUrl ? postLink(suppliedUrl) : suppliedId && /^\d+$/.test(suppliedId)
      && author && /^[A-Za-z0-9_]{1,15}$/.test(author) ? postLink(`https://x.com/${author}/status/${suppliedId}`) : undefined;
    const timestamp = stringField(row, "createdAt", "created_at", "date", "timestamp");
    if (!text || !link || !timestamp || (suppliedId && suppliedId !== link.id) || seen.has(link.id)) continue;
    const numeric = /^\d{10,13}$/.test(timestamp) ? Number(timestamp) : undefined;
    const date = numeric === undefined ? new Date(timestamp) : new Date(numeric < 1e12 ? numeric * 1000 : numeric);
    if (!Number.isFinite(date.getTime())) continue;
    posts.push({ id: link.id, text, url: link.url, author: link.author, createdAt: date.toISOString(),
      likeCount: numberField(row, "likeCount", "like_count", "likes", "favorite_count") ?? 0,
      repostCount: numberField(row, "repostCount", "repost_count", "retweet_count", "retweets") ?? 0,
      replyCount: numberField(row, "replyCount", "reply_count", "replies") ?? 0 });
    seen.add(link.id);
    if (posts.length >= limit) break;
  }
  return posts;
}

function terminalFailure(error: unknown, signal?: AbortSignal): void {
  signal?.throwIfAborted();
  if (isPaidCallDenied(error) || (error instanceof Error && error.name === "AbortError")) throw error;
}

export async function fetchXPosts(opts?: XOptions): Promise<XPost[]> {
  return (await fetchXPostsWithMeta(opts)).posts;
}

export async function fetchXPostsWithMeta(opts: XOptions = {}): Promise<{
  posts: XPost[]; meta: XFetchMeta; cursor: string | null;
}> {
  opts.signal?.throwIfAborted();
  const limit = opts.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new RangeError("X limit must be an integer from 1 to 50");
  if (!hasScavioApiKey()) {
    if (process.env.VANTAGE_DEMO_FIXTURES === "true" && process.env.NODE_ENV !== "production") {
      return { posts: (fixture.posts as XPost[]).slice(0, limit), meta: { provider: "fixture" }, cursor: null };
    }
    throw new Error("X access pending: Scavio acquisition credentials are required; Gateway native X search is unverified");
  }
  let acquired: { posts: XPost[]; cursor: string | null };
  try {
    acquired = await runPaidCall({ context: opts.ctx ?? { sourceKey: "x" }, provider: "scavio",
      action: "x_search", estimateUsd: 0.004, signal: opts.signal }, async () => {
      const value = await createScavioClient().x.search({ search: opts.query?.trim() || "AI developer tools",
        search_type: opts.searchType ?? "Latest", cursor: opts.cursor });
      opts.signal?.throwIfAborted();
      if (value.error || value.success === false) throw new Error("Scavio provider unavailable");
      const nested = value.data;
      const data = nested && typeof nested === "object" && !Array.isArray(nested) ? nested as Record<string, unknown> : undefined;
      const keys = ["results", "tweets", "posts", "items", "timeline", "data"];
      const rawRows = Array.isArray(value) ? value : keys.map(key => (data ?? value)[key]).find(Array.isArray);
      if (!rawRows || rawRows.some(row => !row || typeof row !== "object" || Array.isArray(row))) {
        throw new Error(X_PROVIDER_SHAPE_ERROR);
      }
      const posts = mapPosts(asRecordArray(rawRows), limit);
      if (rawRows.length && !posts.length) throw new Error(X_PROVIDER_SHAPE_ERROR);
      return { value: { posts,
        cursor: stringField(data ?? value, "next_cursor", "cursor") ?? stringField(value, "next_cursor", "cursor") ?? null } };
    });
  } catch (error) {
    terminalFailure(error, opts.signal);
    if (error instanceof Error && error.message === X_PROVIDER_SHAPE_ERROR) throw error;
    throw new Error("X provider unavailable");
  }
  const { posts, cursor } = acquired;
  const meta: XFetchMeta = { provider: "scavio" };
  if (!posts.length || process.env.X_GATEWAY_EXPERIMENT_ENABLED !== "true") return { posts, meta, cursor };
  meta.gatewayMode = "scavio_significance";
  if (!process.env.AI_GATEWAY_API_KEY?.trim()) return { posts, meta: { ...meta, gatewayStatus: "access_pending" }, cursor };
  try {
    const result = await analyzeXPostSignificance(posts, { ctx: opts.ctx, signal: opts.signal });
    return { posts: result.posts, cursor,
      meta: { ...meta, gatewayStatus: "completed", significanceModel: result.model } };
  } catch (error) {
    terminalFailure(error, opts.signal);
    return { posts, cursor, meta: { ...meta, gatewayStatus: "failed" } };
  }
}
