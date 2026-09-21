import { and, desc, eq, gte, lt } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { opportunity, opportunityOutcome } from "@/lib/db/schema";
import {
  computeNorthStar,
  utcWeekBounds,
} from "@/lib/outcomes/metrics";
import type {
  NorthStarMetric,
  OutcomeEvent,
  OutcomeView,
} from "@/lib/outcomes/types";
import { OUTCOME_EVENTS } from "@/lib/outcomes/types";

function toView(row: typeof opportunityOutcome.$inferSelect): OutcomeView {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    opportunityId: row.opportunityId,
    draftId: row.draftId,
    event: row.event as OutcomeEvent,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt.toISOString(),
  };
}

export function isOutcomeEvent(value: unknown): value is OutcomeEvent {
  return (
    typeof value === "string" &&
    (OUTCOME_EVENTS as readonly string[]).includes(value)
  );
}

export async function appendOutcome(opts: {
  workspaceId: string;
  opportunityId: string;
  event: OutcomeEvent;
  draftId?: string | null;
  payload?: Record<string, unknown>;
  idempotencyKey?: string | null;
}): Promise<OutcomeView> {
  const db = getDb();
  // verify opportunity belongs to workspace
  const [opp] = await db
    .select({ id: opportunity.id })
    .from(opportunity)
    .where(
      and(
        eq(opportunity.id, opts.opportunityId),
        eq(opportunity.workspaceId, opts.workspaceId),
      ),
    )
    .limit(1);
  if (!opp) throw new Error("opportunity not found");

  const key = opts.idempotencyKey?.trim() || null;
  if (key) {
    const existing = await db
      .select()
      .from(opportunityOutcome)
      .where(
        and(
          eq(opportunityOutcome.workspaceId, opts.workspaceId),
          eq(opportunityOutcome.idempotencyKey, key),
        ),
      )
      .limit(1);
    if (existing[0]) return toView(existing[0]);
  }

  const inserted = await db
    .insert(opportunityOutcome)
    .values({
      workspaceId: opts.workspaceId,
      opportunityId: opts.opportunityId,
      draftId: opts.draftId ?? null,
      event: opts.event,
      payload: opts.payload ?? {},
      idempotencyKey: key,
    })
    .returning();
  return toView(inserted[0]!);
}

export async function listOutcomes(opts: {
  workspaceId: string;
  opportunityId?: string;
  limit?: number;
}): Promise<OutcomeView[]> {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const rows = opts.opportunityId
    ? await db
        .select()
        .from(opportunityOutcome)
        .where(
          and(
            eq(opportunityOutcome.workspaceId, opts.workspaceId),
            eq(opportunityOutcome.opportunityId, opts.opportunityId),
          ),
        )
        .orderBy(desc(opportunityOutcome.createdAt))
        .limit(limit)
    : await db
        .select()
        .from(opportunityOutcome)
        .where(eq(opportunityOutcome.workspaceId, opts.workspaceId))
        .orderBy(desc(opportunityOutcome.createdAt))
        .limit(limit);
  return rows.map(toView);
}

export async function getNorthStarMetric(opts: {
  workspaceId: string;
  now?: Date;
}): Promise<NorthStarMetric> {
  const db = getDb();
  const { weekStartUtc, weekEndUtc } = utcWeekBounds(opts.now ?? new Date());
  const events = await db
    .select()
    .from(opportunityOutcome)
    .where(
      and(
        eq(opportunityOutcome.workspaceId, opts.workspaceId),
        gte(opportunityOutcome.createdAt, weekStartUtc),
        lt(opportunityOutcome.createdAt, weekEndUtc),
      ),
    );

  const opps = await db
    .select()
    .from(opportunity)
    .where(
      and(
        eq(opportunity.workspaceId, opts.workspaceId),
        gte(opportunity.updatedAt, weekStartUtc),
        lt(opportunity.updatedAt, weekEndUtc),
      ),
    );

  const stats = computeNorthStar({
    events: events.map((e) => ({
      event: e.event as OutcomeEvent,
      createdAt: e.createdAt,
    })),
    weekStartUtc,
    weekEndUtc,
    surfacedCount: opps.length,
  });

  return {
    metric: "qoaa_per_active_workspace_per_week",
    weekStartUtc: weekStartUtc.toISOString(),
    weekEndUtc: weekEndUtc.toISOString(),
    actedOnCount: stats.actedOnCount,
    usefulCount: stats.usefulCount,
    notUsefulCount: stats.notUsefulCount,
    opportunitySurfacedEstimate: opps.length,
    precision: stats.precision,
    actionRate: stats.actionRate,
  };
}
