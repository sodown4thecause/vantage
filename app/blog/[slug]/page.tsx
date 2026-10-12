import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { JsonLd } from "@/components/json-ld";
import { TagLinks } from "@/components/post-list";
import { Shell } from "@/components/shell";
import { formatDate, getAdjacentPosts, getAllPosts, getPost, getRelatedPosts, tagLabel } from "@/lib/blog";
import { SITE_NAME, absoluteUrl } from "@/lib/site";

export const dynamicParams = false;

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return getAllPosts().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return { title: "Post not found", robots: { index: false } };
  const url = `/blog/${post.slug}`;
  const images = post.image ? [{ url: post.image, alt: post.imageAlt ?? post.title }] : undefined;
  return {
    title: post.title,
    description: post.description,
    authors: [{ name: post.author }],
    keywords: post.tags.map(tagLabel),
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      url,
      title: post.title,
      description: post.description,
      publishedTime: post.date,
      modifiedTime: post.updated,
      authors: [post.author],
      tags: post.tags.map(tagLabel),
      images,
    },
    twitter: { card: post.image ? "summary_large_image" : "summary", title: post.title, description: post.description, images: post.image ? [post.image] : undefined },
  };
}

export default async function BlogPost({ params }: Props) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();

  const url = absoluteUrl(`/blog/${post.slug}`);
  const related = getRelatedPosts(post);
  const { older, newer } = getAdjacentPosts(post.slug);
  const revised = post.updated !== post.date;

  const jsonLd: Record<string, unknown>[] = [
    {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      "@id": `${url}#article`,
      headline: post.title,
      description: post.description,
      datePublished: post.date,
      dateModified: post.updated,
      author: { "@type": post.author.startsWith("The ") ? "Organization" : "Person", name: post.author },
      publisher: { "@type": "Organization", name: SITE_NAME, url: absoluteUrl("/") },
      mainEntityOfPage: { "@type": "WebPage", "@id": url },
      url,
      keywords: post.tags.map(tagLabel).join(", "),
      wordCount: post.html.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length,
      inLanguage: "en",
      ...(post.image ? { image: absoluteUrl(post.image) } : {}),
      ...(post.takeaways.length ? { abstract: post.takeaways.join(" ") } : {}),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: absoluteUrl("/") },
        { "@type": "ListItem", position: 2, name: "Blog", item: absoluteUrl("/blog") },
        { "@type": "ListItem", position: 3, name: post.title, item: url },
      ],
    },
  ];
  if (post.faq.length) {
    jsonLd.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: post.faq.map((f) => ({
        "@type": "Question",
        name: f.question,
        acceptedAnswer: { "@type": "Answer", text: f.answer },
      })),
    });
  }

  return (
    <Shell wide section="blog">
      <JsonLd data={jsonLd} />
      <article>
        <header className="max-w-[46rem] space-y-5">
          <nav aria-label="Breadcrumb" className="text-sm text-ridge">
            <ol className="flex flex-wrap gap-2">
              <li><Link href="/blog" className="link">Blog</Link></li>
              {post.tags[0] && (
                <li className="before:mr-2 before:content-['/']">
                  <Link href={`/blog/tag/${post.tags[0]}`} className="link capitalize">{tagLabel(post.tags[0])}</Link>
                </li>
              )}
            </ol>
          </nav>
          <h1 className="display text-4xl sm:text-5xl">{post.title}</h1>
          <p className="max-w-[56ch] text-lg leading-snug text-ridge">{post.description}</p>
          <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-contour pt-4 text-sm text-ridge">
            <span>By <span className="font-semibold text-ink">{post.author}</span></span>
            <span>
              Published <time dateTime={post.date}>{formatDate(post.date)}</time>
            </span>
            {revised && (
              <span>
                Updated <time dateTime={post.updated}>{formatDate(post.updated)}</time>
              </span>
            )}
            <span>{post.readingMinutes} min read</span>
          </div>
        </header>

        {post.image && (
          // eslint-disable-next-line @next/next/no-img-element -- static asset; next/image needs a loader on Workers
          <img src={post.image} alt={post.imageAlt ?? ""} width={1200} height={630} className="mt-10 w-full max-w-[46rem] rounded-lg border border-contour" />
        )}

        <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1fr)_15rem]">
          <div className="min-w-0 space-y-10">
            {post.takeaways.length > 0 && (
              <section aria-labelledby="takeaways" className="max-w-[46rem] rounded-lg border-l-4 border-signal bg-sheet px-6 py-5">
                <h2 id="takeaways" className="mb-3 font-semibold">Key takeaways</h2>
                <ul className="list-disc space-y-1.5 pl-5 marker:text-signal">
                  {post.takeaways.map((t) => <li key={t}>{t}</li>)}
                </ul>
              </section>
            )}

            <div className="article" dangerouslySetInnerHTML={{ __html: post.html }} />

            {post.faq.length > 0 && (
              <section aria-labelledby="post-faq" className="max-w-[46rem] border-t border-contour pt-8">
                <h2 id="post-faq" className="display mb-4 text-3xl">Frequently asked questions</h2>
                <div className="divide-y divide-contour border-y border-contour">
                  {post.faq.map((f) => (
                    <details key={f.question} className="faq py-4">
                      <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-lg font-semibold leading-snug">
                        <h3>{f.question}</h3>
                        <span aria-hidden="true" className="faq-icon mt-1 text-signal">+</span>
                      </summary>
                      <p className="mt-3 max-w-[62ch] text-ridge">{f.answer}</p>
                    </details>
                  ))}
                </div>
              </section>
            )}

            {post.tags.length > 0 && <TagLinks tags={post.tags} />}

            <aside className="max-w-[46rem] rounded-lg bg-ink px-6 py-8 text-paper sm:px-8">
              <p className="text-2xl font-bold leading-tight tracking-tight">
                Find the people already asking for what you build.
              </p>
              <p className="mt-2 max-w-[52ch] opacity-75">
                contextfor.dev hands you up to five conversations worth joining each day, with the posts that prove it. You write the reply.
              </p>
              <Link href="/auth/sign-up" className="btn mt-5">Create a free account</Link>
            </aside>
          </div>

          {post.toc.length > 1 && (
            <nav aria-label="On this page" className="order-first lg:order-none">
              <div className="space-y-2 text-sm lg:sticky lg:top-8">
                <p className="font-semibold">On this page</p>
                <ul className="space-y-1.5 border-l border-contour">
                  {post.toc.map((h) => (
                    <li key={h.id} className={h.depth === 3 ? "pl-7" : "pl-4"}>
                      <a href={`#${h.id}`} className="text-ridge hover:text-ink">{h.text}</a>
                    </li>
                  ))}
                </ul>
              </div>
            </nav>
          )}
        </div>
      </article>

      {related.length > 0 && (
        <section aria-labelledby="related" className="mt-16 border-t border-contour pt-8">
          <h2 id="related" className="mb-4 text-xl font-semibold">Related reading</h2>
          <ul className="grid gap-6 sm:grid-cols-3">
            {related.map((p) => (
              <li key={p.slug} className="space-y-1">
                <Link href={`/blog/${p.slug}`} className="font-semibold leading-snug hover:text-signal">{p.title}</Link>
                <p className="text-sm text-ridge">{p.readingMinutes} min read</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(older || newer) && (
        <nav aria-label="More posts" className="mt-12 grid gap-4 border-t border-contour pt-6 sm:grid-cols-2">
          {older ? (
            <Link href={`/blog/${older.slug}`} rel="prev" className="space-y-1">
              <span className="block text-sm text-ridge">Older post</span>
              <span className="block font-semibold leading-snug hover:text-signal">{older.title}</span>
            </Link>
          ) : <span />}
          {newer && (
            <Link href={`/blog/${newer.slug}`} rel="next" className="space-y-1 sm:text-right">
              <span className="block text-sm text-ridge">Newer post</span>
              <span className="block font-semibold leading-snug hover:text-signal">{newer.title}</span>
            </Link>
          )}
        </nav>
      )}
    </Shell>
  );
}
