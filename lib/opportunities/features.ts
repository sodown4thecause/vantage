import { and, eq, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { document, lead } from "@/lib/db/schema";
import { opportunityOutcome } from "@/lib/db/schema";
import { workspaceLearningWeights } from "@/lib/db/schema";

export type FeatureVector = Record<string, number>;

export const MIN_EVIDENCE_THRESHOLD = 50;
export const MIN_ACTED_ON_THRESHOLD = 10;

const LEARNING_FLAG_ENV = "LEARNING_ENABLED";

function isLearningEnabled(): boolean {
  return process.env[LEARNING_FLAG_ENV] === "true";
}

export type OpportunityLead = {
  id: string;
  workspaceId: string;
  documentId: string;
  intentRung: number;
  confidence: number;
  score: number;
  factors: Record<string, unknown>;
  status: string;
};

export type ScoredOpportunity = {
  lead: OpportunityLead;
  features: FeatureVector;
  baseScore: number;
  adjustedScore: number;
  learningApplied: boolean;
};

export function scoreFeatures(
  lead: OpportunityLead,
  document?: { platform: string; title?: string; contentMd?: string },
): FeatureVector {
  const features: FeatureVector = {
    intent_rung: lead.intentRung,
    confidence: lead.confidence,
    base_score: lead.score,
    platform: document?.platform ?? "unknown",
    has_title: document?.title ? 1 : 0,
    title_length: document?.title ? Math.min(document.title.length / 100, 1) : 0,
    content_length: document?.contentMd ? Math.min(document.contentMd.length / 500, 1) : 0,
  };

  const matched = lead.factors?.matched as string[] | undefined;
  if (matched) {
    features.matched_signals = matched.length;
    features.has_buy_signal = matched.some((m) =>
      /buy|purchase|pricing|subscribe|sign up|checkout/i.test(m),
    )
      ? 1
      : 0;
    features.has_recommend_signal = matched.some((m) =>
      /recommend|suggest|what should i use/i.test(m),
    )
      ? 1
      : 0;
    features.has_comparison_signal = matched.some((m) =>
      /vs\.?|versus|alternative|compared to|better than/i.test(m),
    )
      ? 1
      : 0;
  }

  return features;
}

export function decideStatus(lead: OpportunityLead): string {
  if (lead.status === "approved" || lead.status === "rejected") {
    return lead.status;
  }
  if (lead.intentRung >= 4) {
    return "queued";
  }
  if (lead.intentRung >= 3) {
    return "reviewing";
  }
  return lead.status;
}

export function getActiveWeights(workspaceId: string): Promise<{
  weights: Record<string, number>;
  version: number;
} | null> {
  const db = getDb();
  return db
    .select()
    .from(workspaceLearningWeights)
    .where(
      and(
        eq(workspaceLearningWeights.workspaceId, workspaceId),
        eq(workspaceLearningWeights.active, true),
      ),
    )
    .limit(1)
    .then((rows) => {
      if (!rows.length) return null;
      return {
        weights: rows[0].weights as Record<string, number>,
        version: rows[0].version,
      };
    });
}

export async function hasEvidenceThreshold(workspaceId: string): Promise<boolean> {
  const db = getDb();
  const [outcomeCount] = await db
    .select({ count: opportunityOutcome.id })
    .from(opportunityOutcome)
    .where(eq(opportunityOutcome.workspaceId, workspaceId))
    .limit(1)
    .then((rows) => rows);

  const totalCount = (outcomeCount as { count: string | null }).count;
  if (!totalCount) return false;

  const parsed = parseInt(totalCount, 10);
  if (parsed < MIN_EVIDENCE_THRESHOLD) return false;

  const [actedResult] = await db
    .select({ count: opportunityOutcome.id })
    .from(opportunityOutcome)
    .where(
      and(
        eq(opportunityOutcome.workspaceId, workspaceId),
        eq(opportunityOutcome.outcomeType, "acted_on"),
      ),
    )
    .limit(1)
    .then((rows) => rows);

  const actedCount = (actedResult as { count: string | null }).count;
  if (!actedCount) return false;

  return parseInt(actedCount, 10) >= MIN_ACTED_ON_THRESHOLD;
}

export async function applyLearningWeights(
  baseScore: number,
  features: FeatureVector,
  workspaceId: string,
): Promise<{ score: number; applied: boolean }> {
  if (!isLearningEnabled()) {
    return { score: baseScore, applied: false };
  }

  const evidence = await hasEvidenceThreshold(workspaceId);
  if (!evidence) {
    return { score: baseScore, applied: false };
  }

  const active = await getActiveWeights(workspaceId);
  if (!active) {
    return { score: baseScore, applied: false };
  }

  let adjustment = 0;
  for (const [key, weight] of Object.entries(active.weights)) {
    const featureValue = (features[key] as number | undefined) ?? 0;
    adjustment += weight * featureValue;
  }

  const adjusted = Math.max(0, Math.min(100, baseScore + adjustment * 10));
  return { score: Number(adjusted.toFixed(2)), applied: true };
}

export async function scoreOpportunity(
  lead: OpportunityLead,
  document?: { platform: string; title?: string; contentMd?: string },
  workspaceId?: string,
): Promise<ScoredOpportunity> {
  const features = scoreFeatures(lead, document);
  const baseScore = lead.score;

  if (workspaceId) {
    const result = await applyLearningWeights(baseScore, features, workspaceId);
    return {
      lead,
      features,
      baseScore,
      adjustedScore: result.score,
      learningApplied: result.applied,
    };
  }

  return {
    lead,
    features,
    baseScore,
    adjustedScore: baseScore,
    learningApplied: false,
  };
}

export function getBaselineGoldenVector(): FeatureVector {
  return {
    intent_rung: 0,
    confidence: 0.15,
    base_score: 0,
    platform: "unknown",
    has_title: 0,
    title_length: 0,
    content_length: 0,
    matched_signals: 0,
    has_buy_signal: 0,
    has_recommend_signal: 0,
    has_comparison_signal: 0,
  };
}
