import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PostList, TagLinks } from "@/components/post-list";
import { PageHead, Shell } from "@/components/shell";
import { getAllTags, getPostsByTag, tagLabel } from "@/lib/blog";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ tag: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tag } = await params;
  const label = tagLabel(tag);
  return {
    title: `Posts about ${label}`,
    description: `Articles from the contextfor.dev blog about ${label}.`,
    alternates: { canonical: `/blog/tag/${tag}` },
  };
}

export default async function TagPage({ params }: Props) {
  const { tag } = await params;
  const posts = getPostsByTag(tag);
  if (posts.length === 0) notFound();
  return (
    <Shell wide section="blog">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-ridge">
        <Link href="/blog" className="link">Blog</Link>
      </nav>
      <PageHead title={`Posts about ${tagLabel(tag)}`} />
      <div className="mb-8">
        <TagLinks tags={getAllTags().map((t) => t.tag)} current={tag} />
      </div>
      <PostList posts={posts} />
    </Shell>
  );
}
