import {
  clamp,
  contributionFor,
  round6,
  signalKey,
  weightsByKey,
} from "@/lib/learning/signals";
import { MAX_CONTRIBUTORS, type LearningConfig } from "@/lib/learning/config";
import { clamp01, scoreFeatures } from "@/lib/opportunities/features";
import type {
  OpportunityFeatures,
  OpportunityStatus,
} from "@/lib/opportunities/types";
import type {
  LearningDimension,
  LearningReason,
  PreferenceWeight,
  PreferenceModel,
  RankAdjustment,
} from "@/lib/learning/types";

export type LearningContext = {
  topics: string[];
  sourceIds: string[];
  intents: string[];
};

/**
 * Preference keys that apply to a candidate, strongest first. Deterministic on
 * ties so the same evidence always yields the same explanation.
 */
export function matchedReasons(input: {
  weights: PreferenceWeight[];
  context: LearningContext;
}): LearningReason[] {
  const lookup = weightsByKey(input.weights);
  const terms: Array<readonly [LearningDimension, string]> = [
    ...input.context.topics.map((t) => ["topic", t] as const),
    ...input.context.sourceIds.map((s) => ["source", s] as const),
    ...input.context.intents.map((i) => ["intent", i] as const),
  ];

  const seen = new Set<string>();
  const reasons: LearningReason[] = [];
  for (const [dimension, term] of terms) {
    const key = signalKey(dimension, term);
    if (seen.has(key)) continue;
    seen.add(key);
    const weight = lookup.get(key);
    if (!weight || weight.weight === 0) continue;
    reasons.push({
      key,
      dimension,
      weight: weight.weight,
      contribution: contributionFor(dimension, weight.weight),
      positives: weight.positives,
      negatives: weight.negatives,
    });
  }

  return reasons.sort(
    (a, b) =>
      Math.abs(b.contribution) - Math.abs(a.contribution) ||
      a.key.localeCompare(b.key),
  );
}

/**
 * Apply learned preferences to the deterministic baseline.
 *
 * Conservative guarantees, all enforced here rather than by convention:
 * - an inactive model or disabled flag returns the baseline score unchanged;
 * - the total delta is clamped to `config.maxTotalDelta`;
 * - `status` is passed through untouched, so learning reorders but never
 *   reclassifies, and queue membership stays deterministic.
 */
export function rankWithPreferences(input: {
  features: OpportunityFeatures;
  status: OpportunityStatus;
  model: PreferenceModel | null;
  context: LearningContext;
  config: LearningConfig;
}): RankAdjustment {
  const baselineScore = scoreFeatures(input.features);
  const inert = (reasons: LearningReason[] = []): RankAdjustment => ({
    baselineScore,
    score: baselineScore,
    delta: 0,
    active: false,
    modelVersion: input.model?.version ?? null,
    reasons,
    status: input.status,
  });

  if (!input.config.enabled) return inert();
  if (!input.model || !input.model.active) return inert();

  const contributors = matchedReasons({
    weights: input.model.weights,
    context: input.context,
  }).slice(0, MAX_CONTRIBUTORS);
  if (contributors.length === 0) return inert();

  const rawDelta = contributors.reduce((sum, r) => sum + r.contribution, 0);
  const clamped = clamp(rawDelta, -input.config.maxTotalDelta, input.config.maxTotalDelta);
  if (clamped === 0) return inert(contributors);

  const score = clamp01(baselineScore + clamped);
  return {
    baselineScore,
    score,
    delta: round6(score - baselineScore),
    active: true,
    modelVersion: input.model.version,
    reasons: contributors,
    status: input.status,
  };
}

/** Human-readable explanation, e.g. `topic:crypto -0.06 (1 pos / 3 neg)`. */
export function formatLearningReasons(
  reasons: LearningReason[],
  limit = MAX_CONTRIBUTORS,
): string {
  return reasons
    .slice(0, limit)
    .map(
      (r) =>
        `${r.key} ${r.contribution >= 0 ? "+" : "-"}${Math.abs(r.contribution).toFixed(2)} (${r.positives} pos / ${r.negatives} neg)`,
    )
    .join("; ");
}