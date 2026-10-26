import type { Metadata } from "next";
import Link from "next/link";

import { JsonLd } from "@/components/json-ld";
import { TagLinks } from "@/components/post-list";
import { Shell } from "@/components/shell";
import { formatDate, getAllPosts, getAllTags } from "@/lib/blog";
import styles from "./blog.module.css";
import { SITE_NAME, absoluteUrl } from "@/lib/site";

export const dynamic = "force-static";

const TITLE = "Blog: finding customers in public conversations";
const DESCRIPTION =
  "Practical guides for founders on finding buyers on Reddit, Hacker News and X, reading buying intent, and replying without spamming.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/blog" },
  openGraph: { type: "website", url: "/blog", title: TITLE, description: DESCRIPTION },
};

export default function BlogIndex() {
  const posts = getAllPosts();
  const tags = getAllTags();
  return (
    <Shell wide section="blog">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Blog",
          "@id": absoluteUrl("/blog#blog"),
          name: `${SITE_NAME} blog`,
          description: DESCRIPTION,
          url: absoluteUrl("/blog"),
          publisher: { "@type": "Organization", name: SITE_NAME, url: absoluteUrl("/") },
          blogPost: posts.map((p) => ({
            "@type": "BlogPosting",
            headline: p.title,
            url: absoluteUrl(`/blog/${p.slug}`),
            datePublished: p.date,
            dateModified: p.updated,
          })),
        }}
      />
      <header className={styles.indexHeader}>
        <div>
          <p className={styles.eyebrow}>Notes from the field</p>
          <h1 className={styles.indexTitle}>Finding customers in public conversations</h1>
        </div>
        <p className={styles.indexLede}>Guides for founders on where buyers ask for help, how to read buying intent, and how to reply without spamming.</p>
      </header>
      {tags.length > 0 && (
        <div className={styles.tags}>
          <TagLinks tags={tags.map((t) => t.tag)} />
        </div>
      )}
      {posts.length === 0 ? (
        <p className="text-ridge">The first post is on its way. Subscribe to the <a className="link" href="/blog/rss.xml">RSS feed</a> to get it.</p>
      ) : (
        <ol className={styles.postList}>
          {posts.map((post) => (
            <li key={post.slug} className={styles.post}>
              <div className={styles.postMeta}>
                <time dateTime={post.date}>{formatDate(post.date)}</time>
                <span>{post.readingMinutes} min read</span>
              </div>
              <article>
                <h2 className={styles.postTitle}>
                  <Link href={`/blog/${post.slug}`}>
                    {post.title}<span aria-hidden="true">↗</span>
                  </Link>
                </h2>
                <p className={styles.postDescription}>{post.description}</p>
                {post.tags.length > 0 && <TagLinks tags={post.tags} />}
              </article>
            </li>
          ))}
        </ol>
      )}
    </Shell>
  );
}
