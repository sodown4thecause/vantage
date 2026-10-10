import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { document, opportunity, opportunityEvidence } from "@/lib/db/schema";
import { getLatestMonitoringProfile } from "@/lib/profile/repository";

export const DIGEST_SIZE = 5;

export type DigestOpportunity = {
  opportunityId: string;
  score: number;
  reason: string | null;
  platform: string;
  title: string | null;
  url: string;
};

/** Top active queue opportunities refreshed since `since`, with live source evidence. */
export async function selectDigestOpportunities(
  workspaceId: string,
  opts: { since: Date; limit?: number },
): Promise<DigestOpportunity[]> {
  const limit = Math.min(Math.max(Math.floor(opts.limit ?? DIGEST_SIZE), 1), DIGEST_SIZE);
  const profile = await getLatestMonitoringProfile(workspaceId);
  if (!profile) return [];

  const db = getDb();
  // Match /queue eligibility before the limit so hidden cards cannot crowd out live ones.
  const liveEvidenceSql = sql`coalesce(${document.postedAt}, ${document.collectedAt}) between now() - interval '7 days' and now() + interval '5 minutes'
    and ${document.metadata}->>'provider' is distinct from 'fixture'
    and coalesce(${document.metadata}->>'mocked', 'false') <> 'true'`;
  const rows = await db
    .select()
    .from(opportunity)
    .where(
      and(
        eq(opportunity.workspaceId, workspaceId),
        inArray(opportunity.status, ["opportunity", "monitor", "review"]),
        gte(opportunity.updatedAt, opts.since),
        sql`${opportunity.features}->>'profileVersion' = ${String(profile.version)}`,
        sql`exists (select 1 from ${opportunityEvidence}
          where ${opportunityEvidence.opportunityId} = ${opportunity.id})`,
        sql`not exists (select 1 from ${opportunityEvidence}
          inner join ${document} on ${document.id} = ${opportunityEvidence.documentId}
          where ${opportunityEvidence.opportunityId} = ${opportunity.id}
          and (not (${liveEvidenceSql})
            or ${document.workspaceId} <> ${opportunity.workspaceId}
            or ${opportunityEvidence.workspaceId} <> ${opportunity.workspaceId}))`,
      ),
    )
    .orderBy(desc(opportunity.score), desc(opportunity.updatedAt), asc(opportunity.id))
    .limit(limit);
  if (!rows.length) return [];

  const evidence = await db
    .select({
      opportunityId: opportunityEvidence.opportunityId,
      workspaceId: opportunityEvidence.workspaceId,
      doc: document,
    })
    .from(opportunityEvidence)
    .innerJoin(document, eq(document.id, opportunityEvidence.documentId))
    .where(
      and(
        eq(opportunityEvidence.workspaceId, workspaceId),
        eq(document.workspaceId, workspaceId),
        inArray(opportunityEvidence.opportunityId, rows.map((row) => row.id)),
      ),
    )
    .orderBy(asc(document.id));

  const byOpportunity = new Map<string, typeof evidence>();
  for (const item of evidence) {
    const list = byOpportunity.get(item.opportunityId) ?? [];
    list.push(item);
    byOpportunity.set(item.opportunityId, list);
  }

  const now = Date.now();
  return rows.flatMap((row): DigestOpportunity[] => {
    // Recheck the result boundary in case evidence changes between the two reads.
    if (row.workspaceId !== workspaceId || row.status === "ignore"
      || row.features.profileVersion !== profile.version || row.updatedAt < opts.since) return [];
    const items = byOpportunity.get(row.id);
    if (!items?.length || items.some((item) => {
      const age = now - (item.doc.postedAt ?? item.doc.collectedAt).getTime();
      return item.workspaceId !== workspaceId || item.doc.workspaceId !== workspaceId
        || item.doc.metadata?.provider === "fixture" || String(item.doc.metadata?.mocked) === "true"
        || !Number.isFinite(age) || age < -300_000 || age > 7 * 86400_000;
    })) return [];
    const source = items.reduce((first, item) => item.doc.id < first.doc.id ? item : first).doc;
    return [{
      opportunityId: row.id,
      score: row.score,
      reason: row.whyItMatters,
      platform: source.platform,
      title: source.title,
      url: source.urlCanonical,
    }];
  });
}
