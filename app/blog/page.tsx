import type { Metadata } from "next";

import { JsonLd } from "@/components/json-ld";
import { PostList, TagLinks } from "@/components/post-list";
import { PageHead, Shell } from "@/components/shell";
import { getAllPosts, getAllTags } from "@/lib/blog";
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
      <PageHead
        title="Finding customers in public conversations"
        lede="Guides for founders on where buyers ask for help, how to read buying intent, and how to reply without spamming."
      />
      {tags.length > 0 && (
        <div className="mb-8">
          <TagLinks tags={tags.map((t) => t.tag)} />
        </div>
      )}
      {posts.length === 0 ? (
        <p className="text-ridge">The first post is on its way. Subscribe to the <a className="link" href="/blog/rss.xml">RSS feed</a> to get it.</p>
      ) : (
        <PostList posts={posts} />
      )}
    </Shell>
  );
}
