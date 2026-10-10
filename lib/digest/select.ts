import { and, desc, eq, gte, notInArray } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { document, lead } from "@/lib/db/schema";

export const DIGEST_SIZE = 5;

export type DigestOpportunity = {
  leadId: string;
  score: number;
  intentRung: number;
  reason: string | null;
  platform: string;
  title: string | null;
  url: string;
};

/** Top-ranked leads created since `since`, excluding resolved ones. */
export async function selectDigestOpportunities(
  workspaceId: string,
  opts: { since: Date; limit?: number },
): Promise<DigestOpportunity[]> {
  const limit = opts.limit ?? DIGEST_SIZE;
  const db = getDb();
  return db
    .select({
      leadId: lead.id,
      score: lead.score,
      intentRung: lead.intentRung,
      reason: lead.reason,
      platform: document.platform,
      title: document.title,
      url: document.urlCanonical,
    })
    .from(lead)
    .innerJoin(document, eq(document.id, lead.documentId))
    .where(
      and(
        eq(lead.workspaceId, workspaceId),
        gte(lead.createdAt, opts.since),
        notInArray(lead.status, ["rejected", "expired"]),
      ),
    )
    .orderBy(desc(lead.score), desc(lead.createdAt))
    .limit(limit);
}
