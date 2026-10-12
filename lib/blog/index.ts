import { posts } from "./posts.generated";
import type { Post } from "./types";

export type { Post } from "./types";

/** All published posts, newest first. */
export function getAllPosts(): Post[] {
  return posts;
}

export function getPost(slug: string): Post | null {
  return posts.find((p) => p.slug === slug) ?? null;
}

/** Tags with post counts, most used first. */
export function getAllTags(): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of posts) for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export function getPostsByTag(tag: string): Post[] {
  return posts.filter((p) => p.tags.includes(tag));
}

/** Posts sharing the most tags with `post`, newest first on ties. */
export function getRelatedPosts(post: Post, limit = 3): Post[] {
  return posts
    .filter((p) => p.slug !== post.slug)
    .map((p) => ({ p, shared: p.tags.filter((t) => post.tags.includes(t)).length }))
    .filter(({ shared }) => shared > 0)
    .sort((a, b) => b.shared - a.shared || b.p.date.localeCompare(a.p.date))
    .slice(0, limit)
    .map(({ p }) => p);
}

/** Older and newer neighbours in publication order. */
export function getAdjacentPosts(slug: string): { older: Post | null; newer: Post | null } {
  const i = posts.findIndex((p) => p.slug === slug);
  if (i < 0) return { older: null, newer: null };
  return { older: posts[i + 1] ?? null, newer: posts[i - 1] ?? null };
}

/** "October 12, 2026", fixed to UTC so server and client agree. */
export function formatDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function tagLabel(tag: string): string {
  return tag.replace(/-/g, " ");
}
