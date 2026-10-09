import { and, eq, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { opportunityOutcome } from "@/lib/db/schema";

export type NorthStarResult = {
  workspaceId: string;
  totalOutcomes: number;
  usefulCount: number;
  notUsefulCount: number;
  actedOnCount: number;
  actionRate: number;
  northStarScore: number;
};

export async function computeNorthStar(
  workspaceId: string,
): Promise<NorthStarResult> {
  const db = getDb();

  const [totalRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(opportunityOutcome)
    .where(eq(opportunityOutcome.workspaceId, workspaceId))
    .limit(1);

  const totalOutcomes = totalRow?.count ?? 0;

  const [usefulRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(opportunityOutcome)
    .where(
      and(
        eq(opportunityOutcome.workspaceId, workspaceId),
        eq(opportunityOutcome.outcomeType, "useful"),
      ),
    )
    .limit(1);
  const usefulCount = usefulRow?.count ?? 0;

  const [notUsefulRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(opportunityOutcome)
    .where(
      and(
        eq(opportunityOutcome.workspaceId, workspaceId),
        eq(opportunityOutcome.outcomeType, "not_useful"),
      ),
    )
    .limit(1);
  const notUsefulCount = notUsefulRow?.count ?? 0;

  const [actedOnRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(opportunityOutcome)
    .where(
      and(
        eq(opportunityOutcome.workspaceId, workspaceId),
        eq(opportunityOutcome.outcomeType, "acted_on"),
      ),
    )
    .limit(1);
  const actedOnCount = actedOnRow?.count ?? 0;

  const actionRate = totalOutcomes > 0 ? actedOnCount / totalOutcomes : 0;

  const usefulWeight =
    totalOutcomes > 0 ? usefulCount / totalOutcomes : 0;
  const northStarScore = Number(
    (actionRate * 0.6 + usefulWeight * 0.4).toFixed(4),
  );

  return {
    workspaceId,
    totalOutcomes,
    usefulCount,
    notUsefulCount,
    actedOnCount,
    actionRate: Number(actionRate.toFixed(4)),
    northStarScore,
  };
}

export async function getOutcomesByMetric(
  workspaceId: string,
  metric: string,
): Promise<Record<string, number>> {
  if (metric === "north-star") {
    const result = await computeNorthStar(workspaceId);
    return {
      northStarScore: result.northStarScore,
      actionRate: result.actionRate,
      totalOutcomes: result.totalOutcomes,
    };
  }

  const db = getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(opportunityOutcome)
    .where(
      and(
        eq(opportunityOutcome.workspaceId, workspaceId),
        eq(opportunityOutcome.outcomeType, metric as never),
      ),
    )
    .limit(1);

  return { count: (row as { count: number }).count ?? 0 };
}
