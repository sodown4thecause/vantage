import type { LearningDimension } from "@/lib/learning/types";

/**
 * How much a single learned key can move a score, before the global
 * `maxTotalDelta` clamp. A rejected topic is the noisiest signal (one token can
 * appear in an unrelated post), a source acted on repeatedly is the strongest.
 */
export const DIMENSION_FACTORS: Record<LearningDimension, number> = {
  topic: 0.5,
  intent: 0.8,
  source: 1,
};

/** Only the strongest few keys are allowed to contribute, so explanations stay short. */
export const MAX_CONTRIBUTORS = 3;

export type LearningConfig = {
  /** Master feature flag. False means the baseline ranker is used verbatim. */
  enabled: boolean;
  /** Workspace outcome decisions required before any weight may apply. */
  minWorkspaceEvidence: number;
  /** Per-key decisions required before that key carries any weight. */
  minKeyEvidence: number;
  /** Bayesian shrinkage strength pulling every weight toward zero. */
  priorStrength: number;
  /** Hard cap on a single key's absolute weight. */
  maxAbsWeight: number;
  /** Hard cap on the total score change learning may make. */
  maxTotalDelta: number;
  /** Largest offline rank displacement tolerated before enablement is blocked. */
  maxRankShift: number;
  /** Cutoff used by offline replay metrics; matches the queue limit. */
  k: number;
};

export const DEFAULT_LEARNING_CONFIG: LearningConfig = {
  enabled: false,
  minWorkspaceEvidence: 20,
  minKeyEvidence: 3,
  priorStrength: 5,
  maxAbsWeight: 0.2,
  maxTotalDelta: 0.06,
  maxRankShift: 3,
  k: 5,
};

const TRUTHY = new Set(["1", "true", "yes", "on"]);

export function parseBooleanFlag(
  value: string | undefined,
  fallback: boolean,
): boolean {
  if (value == null) return fallback;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  return TRUTHY.has(normalized);
}

function parseNumber(
  value: string | undefined,
  fallback: number,
  bounds: { min: number; max: number },
): number {
  if (value == null || !value.trim()) return fallback;
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, bounds.min), bounds.max);
}

/**
 * Resolve the learning rollout from the environment. Every value is clamped and
 * a malformed value falls back to the conservative default, so a bad deploy
 * can only ever weaken learning, never amplify it.
 */
export function resolveLearningConfig(
  env: Record<string, string | undefined> = process.env,
  overrides: Partial<LearningConfig> = {},
): LearningConfig {
  const base = { ...DEFAULT_LEARNING_CONFIG };
  const fromEnv: Partial<LearningConfig> = {
    enabled: parseBooleanFlag(env.VANTAGE_LEARNING_ENABLED, base.enabled),
    minWorkspaceEvidence: parseNumber(
      env.VANTAGE_LEARNING_MIN_EVIDENCE,
      base.minWorkspaceEvidence,
      { min: 1, max: 100_000 },
    ),
    minKeyEvidence: parseNumber(
      env.VANTAGE_LEARNING_MIN_KEY_EVIDENCE,
      base.minKeyEvidence,
      { min: 1, max: 1_000 },
    ),
    maxAbsWeight: parseNumber(
      env.VANTAGE_LEARNING_MAX_WEIGHT,
      base.maxAbsWeight,
      { min: 0, max: 1 },
    ),
    maxTotalDelta: parseNumber(
      env.VANTAGE_LEARNING_MAX_DELTA,
      base.maxTotalDelta,
      { min: 0, max: 1 },
    ),
    maxRankShift: parseNumber(
      env.VANTAGE_LEARNING_MAX_RANK_SHIFT,
      base.maxRankShift,
      { min: 0, max: 1_000 },
    ),
    k: parseNumber(env.VANTAGE_LEARNING_K, base.k, { min: 1, max: 50 }),
  };
  return { ...base, ...fromEnv, ...overrides };
}