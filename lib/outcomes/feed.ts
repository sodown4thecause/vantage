import { and, eq, desc, inArray, count } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { opportunityOutcome } from "@/lib/db/schema";
import type { NewOpportunityOutcome } from "@/lib/db/schema";

export type OutcomeFilter = {
  workspaceId: string;
  types?: string[];
  limit?: number;
  offset?: number;
};

export function listOutcomes(filter: OutcomeFilter) {
  const db = getDb();
  const { workspaceId, types, limit = 50, offset = 0 } = filter;

  const conditions = [eq(opportunityOutcome.workspaceId, workspaceId)];

  if (types && types.length) {
    conditions.push(
      inArray(opportunityOutcome.outcomeType, types as never),
    );
  }

  return db
    .select()
    .from(opportunityOutcome)
    .where(and(...conditions))
    .orderBy(desc(opportunityOutcome.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function recordOutcome(
  input: NewOpportunityOutcome,
): Promise<void> {
  const db = getDb();
  await db.insert(opportunityOutcome).values(input);
}

export async function countOutcomes(workspaceId: string): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ count: count() })
    .from(opportunityOutcome)
    .where(eq(opportunityOutcome.workspaceId, workspaceId))
    .limit(1);
  return (row as { count: number }).count;
}

export async function countOutcomesByType(
  workspaceId: string,
  type: string,
): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ count: count() })
    .from(opportunityOutcome)
    .where(
      and(
        eq(opportunityOutcome.workspaceId, workspaceId),
        eq(opportunityOutcome.outcomeType, type as never),
      ),
    )
    .limit(1);
  return (row as { count: number }).count;
}
