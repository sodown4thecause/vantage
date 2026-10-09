import { FeatureVector, scoreFeatures } from "@/lib/opportunities/features";

export type ReplayResult = {
  baselineScore: number;
  candidateScore: number;
  delta: number;
  baselinePrecision: number;
  candidatePrecision: number;
  precisionDelta: number;
  featureVectorsCompared: number;
};

export type ReplaySummary = {
  results: ReplayResult[];
  meanDelta: number;
  meanPrecisionDelta: number;
  regressionDetected: boolean;
};

export function runOfflineReplay(
  items: Array<{
    lead: { score: number; intentRung: number; confidence: number; factors?: Record<string, unknown> };
    document?: { platform: string; title?: string; contentMd?: string };
    baselineFeatures: FeatureVector;
  }>,
  candidateWeights: Record<string, number>,
): ReplaySummary {
  const results: ReplayResult[] = [];

  for (const item of items) {
    const baselineScore = item.lead.score;
    const features = scoreFeatures(item.lead, item.document);

    let candidateScore = baselineScore;
    for (const [key, weight] of Object.entries(candidateWeights)) {
      const featureValue = (features[key] as number | undefined) ?? 0;
      candidateScore += weight * featureValue * 10;
    }
    candidateScore = Math.max(0, Math.min(100, Number(candidateScore.toFixed(2))));

    const delta = Number((candidateScore - baselineScore).toFixed(4));

    const baselineCorrect = baselineScore >= 30 ? 1 : 0;
    const candidateCorrect = candidateScore >= 30 ? 1 : 0;

    results.push({
      baselineScore,
      candidateScore,
      delta,
      baselinePrecision: baselineCorrect,
      candidatePrecision: candidateCorrect,
      precisionDelta: candidateCorrect - baselineCorrect,
      featureVectorsCompared: 1,
    });
  }

  const meanDelta =
    results.length > 0
      ? Number(
          (
            results.reduce((sum, r) => sum + r.delta, 0) / results.length
          ).toFixed(4),
        )
      : 0;

  const baselinePrecision =
    results.length > 0
      ? results.reduce((sum, r) => sum + r.baselinePrecision, 0) / results.length
      : 0;
  const candidatePrecision =
    results.length > 0
      ? results.reduce((sum, r) => sum + r.candidatePrecision, 0) / results.length
      : 0;
  const precisionDelta = Number(
    (candidatePrecision - baselinePrecision).toFixed(4),
  );

  const regressionDetected = precisionDelta < -0.05;

  return {
    results,
    meanDelta,
    meanPrecisionDelta: precisionDelta,
    regressionDetected,
  };
}

export function buildCandidateWeights(
  preferences: Record<string, number>,
): Record<string, number> {
  const normalized: Record<string, number> = {};
  const keys = Object.keys(preferences);
  if (keys.length === 0) return normalized;

  let sumAbs = 0;
  for (const v of Object.values(preferences)) {
    sumAbs += Math.abs(v);
  }

  for (const [key, value] of Object.entries(preferences)) {
    normalized[key] = Number((value / Math.max(sumAbs, 1)).toFixed(4));
  }

  return normalized;
}
