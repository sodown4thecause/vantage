import {
  resolveLearningConfig,
  type LearningConfig,
} from "@/lib/learning/config";
import { rankWithPreferences } from "@/lib/learning/rank";
import { buildPreferenceModel, round6, signalKey } from "@/lib/learning/signals";
import { decideStatus, scoreFeatures } from "@/lib/opportunities/features";
import type {
  EvaluationGate,
  EvaluationReport,
  LearningEvaluationVerdict,
  LearningInactiveReason,
  LearningSample,
  PreferenceModel,
  ReplayMetrics,
} from "@/lib/learning/types";

const EPS = 1e-9;

/**
 * Gates whose failure blocks enablement. `evidence_sufficient` is reported
 * separately because it means "not ready yet", not "measured as harmful".
 */
const BLOCKING_GATES = [
  "deterministic_baseline",
  "train_holdout_separation",
  "no_status_change",
  "bounded_score_delta",
  "bounded_rank_shift",
  "ndcg_not_worse",
];

function rankByScore<T extends { opportunityId: string }>(
  items: T[],
  scoreOf: (item: T) => number,
): T[] {
  return [...items].sort((a, b) => {
    const diff = scoreOf(b) - scoreOf(a);
    if (Math.abs(diff) > EPS) return diff;
    return a.opportunityId.localeCompare(b.opportunityId);
  });
}

function dcgAt(ranked: string[], relevant: ReadonlySet<string>, k: number): number {
  let sum = 0;
  const limit = Math.min(k, ranked.length);
  for (let i = 0; i < limit; i += 1) {
    if (relevant.has(ranked[i]!)) sum += 1 / Math.log2(i + 2);
  }
  return sum;
}

function idcgAt(relevantCount: number, k: number): number {
  let sum = 0;
  for (let i = 0; i < Math.min(k, relevantCount); i += 1) {
    sum += 1 / Math.log2(i + 2);
  }
  return sum;
}

/**
 * Precision@k, NDCG@k and MRR@k over a fixed ranking. Relevance is binary: a
 * holdout item counts as relevant when the workspace positively acted on it.
 */
export function replayMetrics(
  ranked: string[],
  relevant: ReadonlySet<string>,
  k: number,
): ReplayMetrics {
  if (relevant.size === 0) return { ndcg: 0, precision: 0, mrr: 0 };

  let hits = 0;
  let reciprocalRank = 0;
  const limit = Math.min(k, ranked.length);
  for (let i = 0; i < limit; i += 1) {
    if (!relevant.has(ranked[i]!)) continue;
    hits += 1;
    if (reciprocalRank === 0) reciprocalRank = 1 / (i + 1);
  }

  const ideal = idcgAt(relevant.size, k);
  return {
    ndcg: ideal > 0 ? round6(dcgAt(ranked, relevant, k) / ideal) : 0,
    precision: round6(hits / k),
    mrr: round6(reciprocalRank),
  };
}

function statusFor(sample: LearningSample) {
  return sample.status ?? decideStatus(sample.features!);
}

/**
 * Offline replay of baseline-vs-learned ranking for one workspace.
 *
 * The model is trained only on `train`; `holdout` supplies the labels and
 * features used for measurement, so holdout decisions can never leak into the
 * weights being evaluated. Gates cover correctness, stability, and quality —
 * a regression in any of them yields `regression_blocked` rather than a number
 * an operator has to interpret.
 */
export function evaluateReplay(input: {
  train: LearningSample[];
  holdout: LearningSample[];
  workspaceId?: string;
  config?: Partial<LearningConfig>;
  env?: Record<string, string | undefined>;
  createdAt?: Date;
}): EvaluationReport {
  // Resolve through the same path production uses so a replay can never report
  // against a different configuration than the ranker will actually apply.
  const config = resolveLearningConfig(
    input.env ?? process.env,
    input.config,
  );
  const model = buildPreferenceModel({
    workspaceId: input.workspaceId ?? "offline-replay",
    version: 1,
    samples: input.train,
    config,
    createdAt: input.createdAt ?? new Date(0),
  });

  const scored = input.holdout.filter((s) => s.features != null);
  const relevant = new Set(
    scored.filter((s) => s.decision === "positive").map((s) => s.opportunityId),
  );

  const baselineScore = (s: LearningSample) => scoreFeatures(s.features!);
  const contextFor = (s: LearningSample) => ({
    topics: s.topics,
    sourceIds: s.sourceIds,
    intents: s.intents,
  });
  const adjustmentFor = (s: LearningSample, active: PreferenceModel | null) =>
    rankWithPreferences({
      features: s.features!,
      status: statusFor(s),
      model: active,
      context: contextFor(s),
      config,
    });
  const learnedScore = (s: LearningSample) => adjustmentFor(s, model).score;

  const baselineRanked = rankByScore(scored, baselineScore).map((s) => s.opportunityId);
  const learnedRanked = rankByScore(scored, learnedScore).map((s) => s.opportunityId);
  // Learning-off replay of the same inputs. Falsifiable: it fails if the learned
  // path mutates features or otherwise perturbs the baseline it is layered on.
  const inertRanked = rankByScore(scored, (s) => adjustmentFor(s, null).score).map(
    (s) => s.opportunityId,
  );

  const baseline = replayMetrics(baselineRanked, relevant, config.k);
  const learned = replayMetrics(learnedRanked, relevant, config.k);

  const baselineRank = new Map(baselineRanked.map((id, i) => [id, i + 1]));
  const learnedRank = new Map(learnedRanked.map((id, i) => [id, i + 1]));

  let maxRankShift = 0;
  for (const sample of scored) {
    if (sample.decision === "none") continue;
    const before = baselineRank.get(sample.opportunityId)!;
    const after = learnedRank.get(sample.opportunityId)!;
    maxRankShift = Math.max(maxRankShift, Math.abs(before - after));
  }

  // Re-derive status from features rather than trusting the threaded value, so a
  // caller that passes a mutated status is caught.
  let statusFlips = 0;
  let maxScoreDelta = 0;
  let clampFailures = 0;
  let clampEngagements = 0;
  for (const sample of scored) {
    const derivedStatus = decideStatus(sample.features!);
    const adjustment = adjustmentFor(sample, model);
    if (adjustment.status !== derivedStatus) statusFlips += 1;
    maxScoreDelta = Math.max(
      maxScoreDelta,
      Math.abs(adjustment.score - adjustment.baselineScore),
    );

    // Where the raw contributor sum exceeds the cap, the applied delta must sit
    // exactly on it. That is what makes this gate falsifiable: removing the clamp
    // in rank.ts lets the raw sum through and trips it.
    const raw = adjustment.reasons.reduce((sum, r) => sum + r.contribution, 0);
    if (Math.abs(raw) > config.maxTotalDelta + EPS) {
      clampEngagements += 1;
      if (Math.abs(adjustment.delta) > config.maxTotalDelta + EPS) {
        clampFailures += 1;
      }
    }
  }

  // Observations the model attributes to keys, derived independently from train.
  const expectedObservations = input.train.reduce((total, sample) => {
    if (sample.decision === "none") return total;
    const keys = new Set<string>();
    for (const topic of sample.topics) keys.add(signalKey("topic", topic));
    for (const sourceId of sample.sourceIds) keys.add(signalKey("source", sourceId));
    for (const intent of sample.intents) keys.add(signalKey("intent", intent));
    return total + keys.size;
  }, 0);
  const actualObservations = model.weights.reduce(
    (total, w) => total + w.evidence,
    0,
  );
  const inactiveReason: LearningInactiveReason | null = model.disabledReason;

  const gates: EvaluationGate[] = [
    {
      name: "evidence_sufficient",
      passed: model.active,
      detail: model.active
        ? `${model.evidence} workspace decisions cleared the ${config.minWorkspaceEvidence}-decision threshold`
        : `learning inactive: ${model.disabledReason}`,
    },
    {
      name: "deterministic_baseline",
      passed: inertRanked.join("|") === baselineRanked.join("|"),
      detail: "a learning-off replay of the same inputs reproduces the baseline ranking",
    },
    {
      name: "train_holdout_separation",
      passed: actualObservations === expectedObservations,
      detail: `model attributes ${actualObservations} observations; train alone contributes ${expectedObservations}`,
    },
    {
      name: "no_status_change",
      passed: statusFlips === 0,
      detail: `${statusFlips} status reclassifications (learning must not reclassify)`,
    },
    {
      name: "bounded_score_delta",
      passed: clampFailures === 0 && maxScoreDelta <= config.maxTotalDelta + EPS,
      detail: `max score delta ${maxScoreDelta.toFixed(4)} vs cap ${config.maxTotalDelta}; clamp engaged on ${clampEngagements} candidate(s), ${clampFailures} failure(s)`,
    },
    {
      name: "bounded_rank_shift",
      passed: maxRankShift <= config.maxRankShift,
      detail: `max rank shift ${maxRankShift} vs tolerance ${config.maxRankShift}`,
    },
    {
      name: "ndcg_not_worse",
      passed: learned.ndcg >= baseline.ndcg - EPS,
      detail: `NDCG@${config.k} learned ${learned.ndcg.toFixed(4)} vs baseline ${baseline.ndcg.toFixed(4)}`,
    },
  ];

  const failed = gates.filter(
    (g) => BLOCKING_GATES.includes(g.name) && !g.passed,
  );

  let verdict: LearningEvaluationVerdict;
  if (inactiveReason) {
    verdict = "inactive";
  } else if (failed.length > 0) {
    verdict = "regression_blocked";
  } else if (learned.ndcg > baseline.ndcg + EPS) {
    verdict = "improves";
  } else {
    verdict = "no_regression";
  }

  return {
    k: config.k,
    trainSize: input.train.length,
    holdoutSize: scored.length,
    verdict,
    inactiveReason,
    model,
    baseline,
    learned,
    improvement: {
      ndcg: round6(learned.ndcg - baseline.ndcg),
      precision: round6(learned.precision - baseline.precision),
      mrr: round6(learned.mrr - baseline.mrr),
    },
    stability: { maxRankShift, statusFlips, maxScoreDelta: round6(maxScoreDelta) },
    gates,
  };
}