import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { opportunity, opportunityOutcome, opportunityPick } from "@/lib/db/schema";
import { listOpportunityQueue } from "@/lib/opportunities/run";
import type { OpportunityCardView } from "@/lib/opportunities/types";
import type { OutcomeEvent } from "@/lib/outcomes/types";
import { localDay } from "@/lib/retention/days";
import { handoffState, type HandoffState } from "@/lib/retention/handoff-state";

export const DAILY_PICKS = 5;

/**
 * Today's five for a workspace. The first visit of the local day fixes the list: it takes the best
 * live opportunities never shown on an earlier day. Later visits show the same list, topping it up
 * (never past five) when a scan finds more. Picks that stopped being eligible (retired by a scan or
 * a profile change) give up their slot so replacements can fill it. Quiet days show fewer than five.
 */
export async function ensureTodaysPicks(opts: {
  workspaceId: string;
  timeZone: string;
  now?: Date;
}): Promise<{ day: string; cards: OpportunityCardView[] }> {
  const db = getDb();
  const day = localDay(opts.now ?? new Date(), opts.timeZone);
  const readToday = () => db
    .select({ rank: opportunityPick.rank, opportunityId: opportunityPick.opportunityId })
    .from(opportunityPick)
    .where(and(eq(opportunityPick.workspaceId, opts.workspaceId), eq(opportunityPick.pickDate, day)))
    .orderBy(asc(opportunityPick.rank));

  let today = await readToday();
  let cards = await listOpportunityQueue({
    workspaceId: opts.workspaceId,
    limit: DAILY_PICKS,
    onlyIds: today.map((pick) => pick.opportunityId),
  });
  const shown = new Set(cards.map((card) => card.id));
  const retired = today.filter((pick) => !shown.has(pick.opportunityId));
  if (retired.length > 0) {
    await db
      .delete(opportunityPick)
      .where(and(
        eq(opportunityPick.workspaceId, opts.workspaceId),
        eq(opportunityPick.pickDate, day),
        inArray(opportunityPick.opportunityId, retired.map((pick) => pick.opportunityId)),
      ));
    today = today.filter((pick) => shown.has(pick.opportunityId));
  }

  if (today.length < DAILY_PICKS) {
    const fresh = await listOpportunityQueue({
      workspaceId: opts.workspaceId,
      limit: DAILY_PICKS - today.length,
      excludeIds: today.map((pick) => pick.opportunityId),
      notPickedBeforeDay: day,
    });
    const taken = new Set(today.map((pick) => pick.rank));
    const freeRanks = Array.from({ length: DAILY_PICKS }, (_, index) => index + 1).filter((rank) => !taken.has(rank));
    if (fresh.length > 0) {
      await db
        .insert(opportunityPick)
        .values(fresh.map((card, index) => ({
          workspaceId: opts.workspaceId,
          pickDate: day,
          rank: freeRanks[index]!,
          opportunityId: card.id,
        })))
        .onConflictDoNothing();
      today = await readToday();
      cards = await listOpportunityQueue({
        workspaceId: opts.workspaceId,
        limit: DAILY_PICKS,
        onlyIds: today.map((pick) => pick.opportunityId),
      });
    }
  }

  const rankById = new Map(today.map((pick) => [pick.opportunityId, pick.rank]));
  cards.sort((a, b) => (rankById.get(a.id) ?? 0) - (rankById.get(b.id) ?? 0));
  return { day, cards };
}

export type EarlierPick = {
  opportunityId: string;
  title: string;
  state: HandoffState | null;
};

/** The most recent earlier day that had picks, with how far the owner got on each. */
export async function listEarlierPicks(opts: {
  workspaceId: string;
  beforeDay: string;
}): Promise<{ day: string; picks: EarlierPick[] } | null> {
  const db = getDb();
  const [latest] = await db
    .select({ day: opportunityPick.pickDate })
    .from(opportunityPick)
    .where(and(eq(opportunityPick.workspaceId, opts.workspaceId), lt(opportunityPick.pickDate, opts.beforeDay)))
    .orderBy(desc(opportunityPick.pickDate))
    .limit(1);
  if (!latest) return null;

  const rows = await db
    .select({ opportunityId: opportunityPick.opportunityId, title: opportunity.title })
    .from(opportunityPick)
    .innerJoin(opportunity, and(eq(opportunity.id, opportunityPick.opportunityId), eq(opportunity.workspaceId, opportunityPick.workspaceId)))
    .where(and(eq(opportunityPick.workspaceId, opts.workspaceId), eq(opportunityPick.pickDate, latest.day)))
    .orderBy(asc(opportunityPick.rank));
  if (rows.length === 0) return null;

  const events = await db
    .select({ opportunityId: opportunityOutcome.opportunityId, event: opportunityOutcome.event })
    .from(opportunityOutcome)
    .where(and(
      eq(opportunityOutcome.workspaceId, opts.workspaceId),
      inArray(opportunityOutcome.opportunityId, rows.map((row) => row.opportunityId)),
      inArray(opportunityOutcome.event, ["copy", "open", "sent", "replied"]),
    ));
  return {
    day: latest.day,
    picks: rows.map((row) => ({
      opportunityId: row.opportunityId,
      title: row.title,
      state: handoffState(events.filter((event) => event.opportunityId === row.opportunityId).map((event) => event.event as OutcomeEvent)),
    })),
  };
}
