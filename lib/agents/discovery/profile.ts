import { and, desc, eq } from "drizzle-orm";

import type { ReviewProfile } from "@/lib/agents/discovery/relevance";
import { getDb } from "@/lib/db/client";
import { competitor, keywordRecommendation, monitoringProfile } from "@/lib/db/schema";

type Db = ReturnType<typeof getDb>;

/** "https://www.contextfor.dev/pricing" becomes "contextfor": the closest thing to a product name on a saved profile. */
export function nameFromUrl(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, "").split(".")[0] ?? ""; }
  catch { return ""; }
}

/**
 * The profile the quality gate judges against: the owner's latest saved profile plus every competitor and keyword they
 * accepted. Null until the owner has confirmed a profile, because there is nothing to judge relevance against yet.
 */
export async function loadReviewProfile(workspaceId: string, db: Db = getDb()): Promise<ReviewProfile | null> {
  const [latest] = await db.select({
    productUrl: monitoringProfile.productUrl, productDescription: monitoringProfile.productDescription,
    targetCustomer: monitoringProfile.targetCustomer, topics: monitoringProfile.topics, competitors: monitoringProfile.competitors,
  }).from(monitoringProfile).where(eq(monitoringProfile.workspaceId, workspaceId)).orderBy(desc(monitoringProfile.version)).limit(1);
  if (!latest) return null;
  const accepted = await db.select({ domain: competitor.domain }).from(competitor)
    .where(and(eq(competitor.workspaceId, workspaceId), eq(competitor.status, "accepted"))).limit(50);
  const keywords = await db.select({ keyword: keywordRecommendation.keyword }).from(keywordRecommendation)
    .where(and(eq(keywordRecommendation.workspaceId, workspaceId), eq(keywordRecommendation.status, "accepted"))).limit(50);
  return {
    productName: nameFromUrl(latest.productUrl),
    description: latest.productDescription,
    category: "",
    audience: latest.targetCustomer,
    differentiators: [],
    competitors: [...latest.competitors, ...accepted.map((row) => row.domain)],
    keywords: [...latest.topics, ...keywords.map((row) => row.keyword)],
  };
}
