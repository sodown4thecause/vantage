import { and, eq, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { opportunityOutcome } from "@/lib/db/schema";
import { MIN_EVIDENCE_THRESHOLD, MIN_ACTED_ON_THRESHOLD } from "@/lib/opportunities/features";

export type PreferenceFeature = {
  key: string;
  value: number;
};

export type DerivedPreferences = {
  platformWeights: Record<string, number>;
  intentWeights: Record<string, number>;
  totalEvidence: number;
  actedOnCount: number;
  meetsThreshold: boolean;
};

export async function derivePreferences(
  workspaceId: string,
): Promise<DerivedPreferences> {
  const db = getDb();

  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(opportunityOutcome)
    .where(eq(opportunityOutcome.workspaceId, workspaceId))
    .limit(1);

  const totalEvidence = countRow?.count ?? 0;

  const [actedRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(opportunityOutcome)
    .where(
      and(
        eq(opportunityOutcome.workspaceId, workspaceId),
        eq(opportunityOutcome.outcomeType, "acted_on"),
      ),
    )
    .limit(1);

  const actedOnCount = actedRow?.count ?? 0;

  const meetsThreshold =
    totalEvidence >= MIN_EVIDENCE_THRESHOLD &&
    actedOnCount >= MIN_ACTED_ON_THRESHOLD;

  const platformWeights: Record<string, number> = {};
  const intentWeights: Record<string, number> = {};

  if (meetsThreshold && totalEvidence > 0) {
    const outcomes = await db
      .select({
        outcomeType: opportunityOutcome.outcomeType,
        metadata: opportunityOutcome.metadata,
      })
      .from(opportunityOutcome)
      .where(eq(opportunityOutcome.workspaceId, workspaceId));

    const platformScores: Record<string, number> = {};
    const platformCounts: Record<string, number> = {};

    for (const o of outcomes) {
      const meta = o.metadata as Record<string, unknown> | undefined;
      const platform = (meta?.platform as string) ?? "unknown";
      const intent = (meta?.intent as string) ?? "unknown";

      platformScores[platform] = (platformScores[platform] ?? 0) + getOutcomeSignal(o.outcomeType);
      platformCounts[platform] = (platformCounts[platform] ?? 0) + 1;

      const currentIntent = intentWeights[intent] ?? 0;
      intentWeights[intent] = currentIntent + getOutcomeSignal(o.outcomeType);
    }

    for (const [platform, score] of Object.entries(platformScores)) {
      platformWeights[platform] = Number((score / platformCounts[platform]).toFixed(4));
    }

    for (const key of Object.keys(intentWeights)) {
      intentWeights[key] = Number(intentWeights[key].toFixed(4));
    }
  }

  return {
    platformWeights,
    intentWeights,
    totalEvidence,
    actedOnCount,
    meetsThreshold,
  };
}

function getOutcomeSignal(outcomeType: string): number {
  switch (outcomeType) {
    case "acted_on":
      return 1;
    case "useful":
      return 0.5;
    case "not_useful":
      return -0.75;
    default:
      return 0;
  }
}
