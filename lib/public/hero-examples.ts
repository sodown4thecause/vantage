import { and, desc, isNotNull } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { heroExample } from "@/lib/db/schema";
import { isPublicHttpUrl } from "@/lib/http/public-fetch";

export type PublicHeroExample = {
  platform: string;
  community: string;
  title: string;
  sourceUrl: string;
  excerpt: string;
  postedAt: string;
};

export function validHeroExcerpt(excerpt: string, content: string): boolean {
  return excerpt.length > 0 && excerpt.trim() === excerpt &&
    excerpt.split(/\s+/u).length <= 25 && content.includes(excerpt);
}

export async function approvedHeroExamples(): Promise<PublicHeroExample[]> {
  const rows = await getDb().select({
    platform: heroExample.platform,
    community: heroExample.community,
    title: heroExample.title,
    sourceUrl: heroExample.sourceUrl,
    excerpt: heroExample.excerpt,
    postedAt: heroExample.postedAt,
  }).from(heroExample).where(and(
    isNotNull(heroExample.approvedBy),
    isNotNull(heroExample.approvedAt),
  )).orderBy(desc(heroExample.approvedAt), heroExample.id).limit(3);
  return rows.filter((row) => isPublicHttpUrl(row.sourceUrl)).map((row) => ({
    platform: row.platform,
    community: row.community,
    title: row.title,
    sourceUrl: row.sourceUrl,
    excerpt: row.excerpt,
    postedAt: row.postedAt.toISOString(),
  }));
}
