import { and, eq } from "drizzle-orm";

import type { DiscoveryOutcome } from "@/lib/agents/discovery/agent";
import { getDb } from "@/lib/db/client";
import { competitor, keywordRecommendation, proposedProfile, sourceProposal } from "@/lib/db/schema";

type Db = ReturnType<typeof getDb>;
type BatchItem = Parameters<Db["batch"]>[0][number];

/**
 * Stores a run's typed proposals so the owner can confirm them. This is the route handler's job, not the agent's:
 * nothing is "accepted" here. Profiles, competitors and keywords start as "proposed". Sources start as "reviewed"
 * (the quality gate accepted them) or "rejected" (kept so the owner can see why, and so they are not proposed again).
 * Re-runs never overwrite an earlier decision: competitors, keywords and sources already on record are left alone.
 */
export async function saveDiscoveryProposals(
  input: { workspaceId: string; productUrl: string; outcome: DiscoveryOutcome },
  db: Db = getDb(),
): Promise<void> {
  const { workspaceId, productUrl, outcome } = input;

  // Neon's HTTP driver has no interactive transactions, so every write goes in one db.batch: if an insert fails, the
  // earlier draft is not left rejected with nothing to replace it.
  const writes: BatchItem[] = [];

  if (outcome.profile) {
    // A newer draft replaces any earlier one the owner has not confirmed.
    writes.push(
      db.update(proposedProfile).set({ status: "rejected", decidedAt: new Date() })
        .where(and(eq(proposedProfile.workspaceId, workspaceId), eq(proposedProfile.status, "proposed"))),
      db.insert(proposedProfile).values({ workspaceId, productUrl, ...outcome.profile, status: "proposed" }),
    );
  }

  if (outcome.competitors.length > 0) {
    writes.push(db.insert(competitor)
      .values(outcome.competitors.map((c) => ({ workspaceId, domain: c.domain, positioning: c.positioning, evidenceUrl: c.evidenceUrl, status: "proposed" as const })))
      .onConflictDoNothing({ target: [competitor.workspaceId, competitor.domain] }));
  }

  if (outcome.keywords.length > 0) {
    writes.push(db.insert(keywordRecommendation)
      .values(outcome.keywords.map((k) => ({ workspaceId, keyword: k.keyword.toLowerCase(), kind: k.kind, rationale: k.rationale, evidenceUrl: k.evidenceUrl, status: "proposed" as const })))
      .onConflictDoNothing({ target: [keywordRecommendation.workspaceId, keywordRecommendation.keyword] }));
  }

  if (outcome.sources.length > 0) {
    writes.push(db.insert(sourceProposal)
      .values(outcome.sources.map(({ proposal, review }) => ({
        workspaceId, action: "add" as const, sourceType: proposal.sourceType, name: proposal.name, queries: proposal.queries,
        rationale: proposal.rationale, modelScore: proposal.relevanceScore.toFixed(2), relevanceScore: review.score.toFixed(2),
        accepted: review.accepted, reviewReasons: review.reasons, matchedTerms: review.matchedTerms,
        status: review.accepted ? ("reviewed" as const) : ("rejected" as const),
      })))
      .onConflictDoNothing({ target: [sourceProposal.workspaceId, sourceProposal.name, sourceProposal.action] }));
  }

  if (writes.length > 0) await db.batch(writes as [BatchItem, ...BatchItem[]]);
}
