import type { PreferenceWeightRow } from "@/lib/db/schema";
import type {
  OpportunityFeatures,
  OpportunityStatus,
} from "@/lib/opportunities/types";
import type { OutcomeEvent } from "@/lib/outcomes/types";

export const LEARNING_DIMENSIONS = ["topic", "source", "intent"] as const;
export type LearningDimension = (typeof LEARNING_DIMENSIONS)[number];

/** Outcome events that count as an explicit positive decision. */
export const POSITIVE_DECISION_EVENTS = [
  "useful",
  "saved",
  "acted_on",
  "published_url",
  "conversion",
] as const;

/** Outcome events that count as an explicit negative decision. */
export const NEGATIVE_DECISION_EVENTS = ["not_useful", "rejected"] as const;

/**
 * `draft_edit` and `utm_click` are never scored. They describe edits and traffic
 * for our own published reply, not a decision about whether the workspace wants
 * more of this topic — scoring them would build a feedback loop on our output.
 */
export const UNSCORED_DECISION_EVENTS = ["draft_edit", "utm_click"] as const;

export type DecisionSignal = "positive" | "negative" | "none";

export type PreferenceWeight = PreferenceWeightRow;

export type LearningInactiveReason =
  | "flag_disabled"
  | "insufficient_evidence"
  | "no_signal";

/**
 * A versioned, workspace-scoped set of bounded preference weights.
 * Inert by default: `active` stays false until the workspace clears the
 * minimum evidence threshold.
 */
export type PreferenceModel = {
  workspaceId: string;
  version: number;
  weights: PreferenceWeight[];
  positiveEvents: number;
  negativeEvents: number;
  evidence: number;
  active: boolean;
  disabledReason: LearningInactiveReason | null;
  createdAt: string;
};

/**
 * One workspace outcome decision plus the preference keys it touches.
 * Samples with `decision: "none"` never influence weights.
 */
export type LearningSample = {
  opportunityId: string;
  topics: string[];
  sourceIds: string[];
  intents: string[];
  decision: DecisionSignal;
  /** Present when the sample can be scored (replay holdout, ranker context). */
  features?: OpportunityFeatures;
  status?: OpportunityStatus;
};

export type LearningReason = {
  key: string;
  dimension: LearningDimension;
  weight: number;
  contribution: number;
  positives: number;
  negatives: number;
};

/**
 * The complete effect of learning on one scored candidate.
 * `status` is always the deterministic baseline status: learning reorders the
 * queue but never reclassifies an opportunity.
 */
export type RankAdjustment = {
  baselineScore: number;
  score: number;
  delta: number;
  active: boolean;
  modelVersion: number | null;
  reasons: LearningReason[];
  status: OpportunityStatus;
};

export type ReplayMetrics = {
  ndcg: number;
  precision: number;
  mrr: number;
};

export type EvaluationGate = {
  name: string;
  passed: boolean;
  detail: string;
};

export type LearningEvaluationVerdict =
  | "inactive"
  | "regression_blocked"
  | "no_regression"
  | "improves";

export type EvaluationReport = {
  k: number;
  trainSize: number;
  holdoutSize: number;
  verdict: LearningEvaluationVerdict;
  inactiveReason: LearningInactiveReason | null;
  model: PreferenceModel;
  baseline: ReplayMetrics;
  learned: ReplayMetrics;
  improvement: { ndcg: number; precision: number; mrr: number };
  stability: {
    maxRankShift: number;
    statusFlips: number;
    maxScoreDelta: number;
  };
  gates: EvaluationGate[];
};

export function decisionForEvent(event: OutcomeEvent): DecisionSignal {
  if ((UNSCORED_DECISION_EVENTS as readonly string[]).includes(event)) {
    return "none";
  }
  if ((POSITIVE_DECISION_EVENTS as readonly string[]).includes(event)) {
    return "positive";
  }
  if ((NEGATIVE_DECISION_EVENTS as readonly string[]).includes(event)) {
    return "negative";
  }
  return "none";
}

/**
 * Collapse every decision recorded for one opportunity. Mixed feedback is
 * treated as no signal rather than as a coin flip, so a noisy workspace
 * produces fewer — not more confident — weights.
 */
export function resolveDecision(
  decisions: readonly DecisionSignal[],
): DecisionSignal {
  let positive = false;
  let negative = false;
  for (const decision of decisions) {
    if (decision === "positive") positive = true;
    else if (decision === "negative") negative = true;
  }
  if (positive && negative) return "none";
  if (positive) return "positive";
  if (negative) return "negative";
  return "none";
}