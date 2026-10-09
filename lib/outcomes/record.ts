import { and, eq } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { lead, opportunityOutcome } from "@/lib/db/schema";
import type { OutcomeType } from "@/lib/db/schema";

export const OUTCOME_TYPES: OutcomeType[] = ["useful", "not_useful", "acted_on"];

export function isOutcomeType(value: unknown): value is OutcomeType {
  return typeof value === "string" && OUTCOME_TYPES.includes(value as OutcomeType);
}

export type RecordOutcomeResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Record what the reviewer did with a lead. Scoped to the workspace so a
 * caller can never attach an outcome to another workspace's lead.
 */
export async function recordOutcome(input: {
  workspaceId: string;
  leadId: string;
  outcomeType: OutcomeType;
}): Promise<RecordOutcomeResult> {
  const db = getDb();

  const [owned] = await db
    .select({ id: lead.id })
    .from(lead)
    .where(
      and(eq(lead.id, input.leadId), eq(lead.workspaceId, input.workspaceId)),
    )
    .limit(1);

  if (!owned) {
    return { ok: false, error: "Lead not found for this workspace." };
  }

  try {
    await db
      .insert(opportunityOutcome)
      .values({
        workspaceId: input.workspaceId,
        leadId: input.leadId,
        outcomeType: input.outcomeType,
      })
      .onConflictDoNothing({
        target: [opportunityOutcome.leadId, opportunityOutcome.outcomeType],
      });
  } catch (err) {
    console.error("[outcomes] record failed", {
      workspaceId: input.workspaceId,
      leadId: input.leadId,
      outcomeType: input.outcomeType,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "Could not record the outcome." };
  }

  return { ok: true };
}
