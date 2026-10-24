import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { opportunity, opportunityOutcome } from "@/lib/db/schema";
import type { MonthlyRecap } from "@/lib/retention/handoff-state";
import { startOfLocalMonth } from "@/lib/retention/days";

export type MarkedReply = {
  opportunityId: string;
  title: string;
  state: "sent" | "replied";
  markedAt: string;
};

/** Conversations the owner marked sent or replied to, newest first, one row per conversation. */
export async function listMarkedReplies(opts: { workspaceId: string; limit?: number }): Promise<MarkedReply[]> {
  const rows = await getDb()
    .select({
      opportunityId: opportunityOutcome.opportunityId,
      event: opportunityOutcome.event,
      createdAt: opportunityOutcome.createdAt,
      title: opportunity.title,
    })
    .from(opportunityOutcome)
    .innerJoin(opportunity, and(eq(opportunity.id, opportunityOutcome.opportunityId), eq(opportunity.workspaceId, opportunityOutcome.workspaceId)))
    .where(and(eq(opportunityOutcome.workspaceId, opts.workspaceId), inArray(opportunityOutcome.event, ["sent", "replied"])))
    .orderBy(desc(opportunityOutcome.createdAt))
    .limit(200);

  const seen = new Set<string>();
  const latest: MarkedReply[] = [];
  for (const row of rows) {
    if (seen.has(row.opportunityId)) continue;
    seen.add(row.opportunityId);
    latest.push({
      opportunityId: row.opportunityId,
      title: row.title,
      state: row.event === "replied" ? "replied" : "sent",
      markedAt: row.createdAt.toISOString(),
    });
  }
  return latest.slice(0, Math.min(Math.max(opts.limit ?? 20, 1), 100));
}

/** Distinct conversations copied, marked sent and marked replied since the local month began. */
export async function monthlyRecap(opts: { workspaceId: string; timeZone: string; now?: Date }): Promise<MonthlyRecap> {
  const rows = await getDb()
    .select({
      event: opportunityOutcome.event,
      conversations: sql<number>`count(distinct ${opportunityOutcome.opportunityId})`.mapWith(Number),
    })
    .from(opportunityOutcome)
    .where(and(
      eq(opportunityOutcome.workspaceId, opts.workspaceId),
      gte(opportunityOutcome.createdAt, startOfLocalMonth(opts.now ?? new Date(), opts.timeZone)),
      inArray(opportunityOutcome.event, ["copy", "sent", "replied"]),
    ))
    .groupBy(opportunityOutcome.event);
  const count = (event: string) => rows.find((row) => row.event === event)?.conversations ?? 0;
  return { copied: count("copy"), sent: count("sent"), replied: count("replied") };
}
