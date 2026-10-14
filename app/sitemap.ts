import type { MetadataRoute } from "next";

import { getAllPosts, getAllTags } from "@/lib/blog";
import { listDestinations } from "@/lib/destinations/repository";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const posts = getAllPosts();
  const entries: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    {
      url: `${base}/blog`,
      changeFrequency: "weekly",
      priority: 0.8,
      ...(posts[0] ? { lastModified: new Date(`${posts[0].updated}T00:00:00Z`) } : {}),
    },
    ...posts.map((p) => ({
      url: `${base}/blog/${p.slug}`,
      lastModified: new Date(`${p.updated}T00:00:00Z`),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
    ...getAllTags().map(({ tag }) => ({ url: `${base}/blog/tag/${tag}`, changeFrequency: "weekly" as const, priority: 0.4 })),
    { url: `${base}/launch`, changeFrequency: "weekly" },
    { url: `${base}/pricing`, changeFrequency: "monthly", priority: 0.8 },
  ];
  try {
    for (const row of await listDestinations()) {
      entries.push({
        url: `${base}/launch/${row.slug}`,
        lastModified: new Date(`${row.lastVerified}T00:00:00Z`),
        changeFrequency: "monthly",
      });
    }
  } catch (err) {
    // A database outage must not break the sitemap; the static pages are still listed.
    console.error("[sitemap] failed to load destinations", { error: err instanceof Error ? err.name : "unknown" });
  }
  return entries;
}
