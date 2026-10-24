import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { opportunity, opportunityOutcome, opportunityPick } from "@/lib/db/schema";
import { listOpportunityQueue } from "@/lib/opportunities/run";
import type { OpportunityCardView } from "@/lib/opportunities/types";
import type { OutcomeEvent } from "@/lib/outcomes/types";
import { localDay } from "@/lib/retention/days";
import { handoffState, type HandoffState } from "@/lib/retention/handoff-state";

export const DAILY_PICKS = 5;

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string; cause?: { code?: string } } | null);
  return code?.code === "23505" || code?.cause?.code === "23505";
}

/**
 * Today's five for a workspace. The first visit of the local day fixes the list: it takes the best
 * live opportunities never shown on an earlier day. Later visits show the same list, topping it up
 * (never past five) when a scan finds more. A pick that stops being eligible (retired by a scan or
 * a profile change) gives up its slot, so replacements can fill it, but its row is kept: the shown
 * history decides what may be picked again and feeds the day's follow-up list. If the same
 * opportunity becomes eligible again later that day it can take a free slot back.
 */
export async function ensureTodaysPicks(opts: {
  workspaceId: string;
  timeZone: string;
  now?: Date;
}): Promise<{ day: string; cards: OpportunityCardView[] }> {
  const db = getDb();
  const day = localDay(opts.now ?? new Date(), opts.timeZone);
  const readHeld = async () => (await db
    .select({ rank: opportunityPick.rank, opportunityId: opportunityPick.opportunityId })
    .from(opportunityPick)
    .where(and(eq(opportunityPick.workspaceId, opts.workspaceId), eq(opportunityPick.pickDate, day), isNotNull(opportunityPick.rank)))
    .orderBy(asc(opportunityPick.rank))) as Array<{ rank: number; opportunityId: string }>;
  const readCards = (picks: Array<{ opportunityId: string }>) => listOpportunityQueue({
    workspaceId: opts.workspaceId,
    limit: DAILY_PICKS,
    onlyIds: picks.map((pick) => pick.opportunityId),
  });

  let held = await readHeld();
  let cards = await readCards(held);
  const live = new Set(cards.map((card) => card.id));
  const retired = held.filter((pick) => !live.has(pick.opportunityId));
  if (retired.length > 0) {
    await db
      .update(opportunityPick)
      .set({ rank: null })
      .where(and(
        eq(opportunityPick.workspaceId, opts.workspaceId),
        eq(opportunityPick.pickDate, day),
        inArray(opportunityPick.opportunityId, retired.map((pick) => pick.opportunityId)),
      ));
    held = held.filter((pick) => live.has(pick.opportunityId));
  }

  if (held.length < DAILY_PICKS) {
    const fresh = await listOpportunityQueue({
      workspaceId: opts.workspaceId,
      limit: DAILY_PICKS - held.length,
      excludeIds: held.map((pick) => pick.opportunityId),
      notPickedBeforeDay: day,
    });
    const taken = new Set(held.map((pick) => pick.rank));
    const freeRanks = Array.from({ length: DAILY_PICKS }, (_, index) => index + 1).filter((rank) => !taken.has(rank));
    if (fresh.length > 0) {
      try {
        await db
          .insert(opportunityPick)
          .values(fresh.map((card, index) => ({
            workspaceId: opts.workspaceId,
            pickDate: day,
            rank: freeRanks[index]!,
            opportunityId: card.id,
          })))
          .onConflictDoUpdate({
            target: [opportunityPick.workspaceId, opportunityPick.pickDate, opportunityPick.opportunityId],
            set: { rank: sql`excluded.rank` },
            setWhere: isNull(opportunityPick.rank),
          });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
      held = await readHeld();
      cards = await readCards(held);
    }
  }

  const rankById = new Map(held.map((pick) => [pick.opportunityId, pick.rank]));
  cards.sort((a, b) => (rankById.get(a.id) ?? 0) - (rankById.get(b.id) ?? 0));
  return { day, cards };
}

export type EarlierPick = {
  opportunityId: string;
  title: string;
  state: HandoffState | null;
};

/** The most recent earlier day that had picks, with how far the owner got on each. Picks that lost
 * their slot after being retired stay listed, after the ones that held a slot to the end. */
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
    .orderBy(asc(opportunityPick.rank), asc(opportunityPick.createdAt));
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
