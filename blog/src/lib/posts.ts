import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'posts'>;

/** Published (non-draft) posts, newest first. The single source of truth for ordering and draft policy. */
export async function getPublishedPosts(): Promise<Post[]> {
  const posts = await getCollection('posts', (p) => !p.data.draft);
  return posts.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

/** Site-relative URL of a post. Matches the `[...id]` route, so nested post folders work. */
export const postPath = (post: Post) => `/posts/${post.id}/`;
