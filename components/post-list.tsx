import Link from "next/link";

import { formatDate, tagLabel, type Post } from "@/lib/blog";

/** Chronological list of posts used by the blog index and tag pages. */
export function PostList({ posts }: { posts: Post[] }) {
  return (
    <ul className="divide-y divide-contour border-y border-contour" data-testid="post-list">
      {posts.map((post) => (
        <li key={post.slug}>
          <article className="grid gap-2 py-7 sm:grid-cols-[10rem_1fr] sm:gap-8">
            <div className="text-sm text-ridge sm:pt-1.5">
              <time dateTime={post.date}>{formatDate(post.date)}</time>
              <p>{post.readingMinutes} min read</p>
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold leading-tight tracking-tight">
                <Link href={`/blog/${post.slug}`} className="hover:text-signal">
                  {post.title}
                </Link>
              </h2>
              <p className="max-w-[62ch] text-ridge">{post.description}</p>
              {post.tags.length > 0 && <TagLinks tags={post.tags} />}
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}

export function TagLinks({ tags, current }: { tags: string[]; current?: string }) {
  return (
    <ul className="flex flex-wrap gap-2 text-sm" aria-label="Topics">
      {tags.map((tag) => (
        <li key={tag}>
          <Link
            href={`/blog/tag/${tag}`}
            aria-current={tag === current ? "page" : undefined}
            className={
              "inline-block rounded-full border px-2.5 py-0.5 transition-colors " +
              (tag === current ? "border-ink bg-ink text-paper" : "border-contour text-ridge hover:border-ridge hover:text-ink")
            }
          >
            {tagLabel(tag)}
          </Link>
        </li>
      ))}
    </ul>
  );
}
