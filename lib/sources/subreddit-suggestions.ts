import { and, desc, eq, isNotNull, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { document, source } from "@/lib/db/schema";

export type SubredditSuggestion = { subreddit: string; posts: number };

/** Reddit subreddit names: letters, digits and underscores, 2 to 21 characters. */
const SUBREDDIT_RE = /^[A-Za-z0-9_]{2,21}$/;
/** A subreddit needs this many collected posts before it is worth suggesting. */
const MIN_POSTS = 2;
/** Busiest subreddits considered before filtering, so tracked or invalid names cannot starve the list. */
const CANDIDATE_LIMIT = 20;

/**
 * Subreddits that keep appearing in this workspace's collected Reddit posts and are not tracked yet.
 * Reddit searches are site-wide by default, so these are the narrower searches worth a one-click add.
 */
export async function listSubredditSuggestions(workspaceId: string, limit = 5): Promise<SubredditSuggestion[]> {
  const db = getDb();
  const subreddit = sql<string | null>`${document.metadata}->>'subreddit'`;
  const posts = sql<number>`count(*)::int`;
  // Sample data is labelled in the UI, so it must never count as live posts (same rule as the digest and queue).
  const liveOnly = sql`(${document.metadata}->>'provider' is distinct from 'fixture' and coalesce(${document.metadata}->>'mocked', 'false') <> 'true')`;

  const [counts, tracked] = await Promise.all([
    db.select({ subreddit, posts })
      .from(document)
      .where(and(eq(document.workspaceId, workspaceId), eq(document.platform, "reddit"), isNotNull(subreddit), liveOnly))
      // Group by output position: the jsonb key is a bound parameter, so Postgres would not match a second copy of it.
      .groupBy(sql`1`)
      .orderBy(desc(posts), sql`1`)
      .limit(CANDIDATE_LIMIT),
    db.select({ config: source.config })
      .from(source)
      .where(and(eq(source.workspaceId, workspaceId), eq(source.type, "reddit"))),
  ]);

  const trackedNames = new Set(tracked.flatMap(({ config }) => {
    const name = config.subreddit;
    return typeof name === "string" ? [normalizeSubreddit(name)] : [];
  }));

  const suggestions: SubredditSuggestion[] = [];
  for (const row of counts) {
    if (suggestions.length >= limit) break;
    const name = row.subreddit ?? "";
    const count = Number(row.posts);
    if (!SUBREDDIT_RE.test(name) || count < MIN_POSTS || trackedNames.has(name.toLowerCase())) continue;
    suggestions.push({ subreddit: name, posts: count });
  }
  return suggestions;
}

function normalizeSubreddit(value: string): string {
  return value.trim().replace(/^\/?r\//i, "").toLowerCase();
}
