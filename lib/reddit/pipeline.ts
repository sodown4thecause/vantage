import type { RedditPost } from "@/lib/reddit/client";

/**
 * Reddit posts flow fetchers -> enrichers -> filters before the collector turns them into documents,
 * so a new discovery lane or enrichment never has to touch scoring.
 */
export type RedditEnricher = (posts: RedditPost[]) => Promise<RedditPost[]>;
export type RedditFilter = (post: RedditPost) => boolean;

const KNOWN_BOTS = new Set(["automoderator", "remindmebot", "sneakpeekbot", "savevideo", "repostsleuthbot", "wikisummarizerbot"]);

/** AutoModerator, the usual helper bots, and names ending in `Bot`, `_bot` or `-bot`. Lowercase `bot` (Abbot, Talbot) is a person. */
export function isBotAuthor(author: string | undefined): boolean {
  if (!author) return false;
  const name = author.trim().replace(/^u\//i, "");
  return KNOWN_BOTS.has(name.toLowerCase()) || /(?:[-_]bot|Bot|BOT)$/.test(name);
}

export const dropBotPosts: RedditFilter = post => !isBotAuthor(post.author);

export async function runRedditPipeline(posts: RedditPost[], enrichers: RedditEnricher[], filters: RedditFilter[]): Promise<RedditPost[]> {
  let current = posts;
  for (const enrich of enrichers) current = await enrich(current);
  return current.filter(post => filters.every(keep => keep(post)));
}
