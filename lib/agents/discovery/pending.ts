import { and, desc, eq, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { competitor, keywordRecommendation, proposedProfile, sourceProposal } from "@/lib/db/schema";

type Db = ReturnType<typeof getDb>;

/** The workspace's pending proposals, for the cards a UI renders: the latest profile draft, competitors, keywords and reviewed sources. */
export async function listPendingProposals(workspaceId: string, db: Db = getDb()) {
  const [profile] = await db.select().from(proposedProfile)
    .where(and(eq(proposedProfile.workspaceId, workspaceId), eq(proposedProfile.status, "proposed"))).orderBy(desc(proposedProfile.createdAt)).limit(1);
  const competitors = await db.select().from(competitor)
    .where(and(eq(competitor.workspaceId, workspaceId), eq(competitor.status, "proposed"))).limit(50);
  const keywords = await db.select().from(keywordRecommendation)
    .where(and(eq(keywordRecommendation.workspaceId, workspaceId), eq(keywordRecommendation.status, "proposed"))).limit(50);
  const sources = await db.select().from(sourceProposal)
    .where(and(eq(sourceProposal.workspaceId, workspaceId), inArray(sourceProposal.status, ["reviewed", "rejected", "removal_proposed"]))).limit(100);
  return { profile: profile ?? null, competitors, keywords, sources };
}
