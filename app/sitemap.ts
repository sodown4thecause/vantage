import type { MetadataRoute } from "next";

import { listDestinations } from "@/lib/destinations/repository";

export const dynamic = "force-dynamic";

/** Absolute origin for sitemap entries. Set NEXT_PUBLIC_SITE_URL per environment. */
function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://dontkillmyvibe.liam-wilson1990.workers.dev").replace(/\/+$/, "");
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const entries: MetadataRoute.Sitemap = [{ url: `${base}/launch`, changeFrequency: "weekly" }];
  try {
    for (const row of await listDestinations()) {
      entries.push({
        url: `${base}/launch/${row.slug}`,
        lastModified: new Date(`${row.lastVerified}T00:00:00Z`),
        changeFrequency: "monthly",
      });
    }
  } catch (err) {
    // A database outage must not break the sitemap; the index page is still listed.
    console.error("[sitemap] failed to load destinations", { error: err instanceof Error ? err.name : "unknown" });
  }
  return entries;
}
