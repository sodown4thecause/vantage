import { tokenize } from "@/lib/opportunities/features";
import { classifyIntent } from "@/lib/pipeline/intent-ladder";
import type { NormalizedDocument } from "@/lib/pipeline/normalize";
import { DIMENSION_FACTORS, type LearningConfig } from "@/lib/learning/config";
import {
  LEARNING_DIMENSIONS,
  type LearningDimension,
  type LearningSample,
  type PreferenceModel,
  type PreferenceWeight,
} from "@/lib/learning/types";

export const MAX_TOPIC_TERMS = 6;

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "anyone",
  "been",
  "being",
  "does",
  "from",
  "have",
  "help",
  "here",
  "just",
  "know",
  "like",
  "looking",
  "more",
  "most",
  "much",
  "need",
  "only",
  "other",
  "over",
  "please",
  "searching",
  "someone",
  "some",
  "such",
  "than",
  "that",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "thanks",
  "using",
  "very",
  "want",
  "what",
  "when",
  "where",
  "which",
  "will",
  "with",
  "would",
  "your",
]);

/** Field name parts that would mean collected content leaked into a model. */
const FORBIDDEN_FIELD_PARTS = new Set([
  "author",
  "body",
  "content",
  "excerpt",
  "html",
  "markdown",
  "md",
  "raw",
  "snapshot",
  "text",
  "title",
  "url",
]);

/** A legitimate key or term is a short lowercase token; anything longer is prose. */
const MAX_TERM_LENGTH = 40;

/**
 * A key is `<dimension>:<term>`. The term alone is bounded — production source
 * ids are 36-char UUIDs, so the dimension prefix must not count against it.
 */
const KEY_PATTERN = new RegExp(
  `^(?:${LEARNING_DIMENSIONS.join("|")}):[a-z0-9:_-]{1,${MAX_TERM_LENGTH}}$`,
);

export function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

export function round6(n: number): number {
  return Number.isFinite(n) ? Number(n.toFixed(6)) : 0;
}

function sanitizeTerm(term: string): string {
  return term.toLowerCase().replace(/[^a-z0-9:_-]/g, "").slice(0, MAX_TERM_LENGTH);
}

export function signalKey(dimension: LearningDimension, term: string): string {
  return `${dimension}:${sanitizeTerm(term)}`;
}

export function topicTermsForDocuments(
  docs: Array<Pick<NormalizedDocument, "title" | "text">>,
  limit = MAX_TOPIC_TERMS,
): string[] {
  const scores = new Map<string, number>();
  const add = (token: string, weight: number) => {
    if (token.length <= 3 || STOP_WORDS.has(token)) return;
    scores.set(token, (scores.get(token) ?? 0) + weight);
  };
  for (const doc of docs) {
    for (const token of new Set(tokenize(doc.title ?? ""))) add(token, 2);
    for (const token of new Set(tokenize(doc.text))) add(token, 1);
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([token]) => token);
}

export function intentTermsForDocuments(
  docs: NormalizedDocument[],
): string[] {
  const rungs = new Set<number>();
  for (const doc of docs) {
    rungs.add(classifyIntent(doc).intentRung);
  }
  return [...rungs].sort((a, b) => b - a).map((rung) => `rung_${rung}`);
}

export function sourceIdsForDocuments(
  docs: Array<Pick<NormalizedDocument, "id">>,
  sourceIdByDocId: ReadonlyMap<string, string | null>,
): string[] {
  const ids = new Set<string>();
  for (const doc of docs) {
    const sourceId = sourceIdByDocId.get(doc.id);
    if (sourceId) ids.add(sourceId);
  }
  return [...ids].sort();
}

/**
 * Shrunk weight for one key. Zero below the per-key evidence threshold, so a
 * key needs repeated agreement before it can move anything.
 */
export function signalWeight(
  positives: number,
  negatives: number,
  config: LearningConfig,
): number {
  const evidence = positives + negatives;
  if (evidence <= 0 || evidence < config.minKeyEvidence) return 0;
  const net = (positives - negatives) / evidence;
  const shrunk = net * (evidence / (evidence + config.priorStrength));
  return round6(clamp(shrunk, -config.maxAbsWeight, config.maxAbsWeight));
}

export function contributionFor(
  dimension: LearningDimension,
  weight: number,
): number {
  return round6(weight * DIMENSION_FACTORS[dimension]);
}

/**
 * Fold workspace decisions into bounded per-key weights. Samples are expected to
 * come from a single workspace query; nothing here reads another workspace.
 */
export function derivePreferenceSignals(
  samples: LearningSample[],
  config: LearningConfig,
): PreferenceWeight[] {
  const counts = new Map<
    string,
    { dimension: LearningDimension; positives: number; negatives: number }
  >();

  for (const sample of samples) {
    if (sample.decision === "none") continue;
    const positive = sample.decision === "positive";
    const terms: Array<readonly [LearningDimension, string]> = [
      ...sample.topics.map((t) => ["topic", t] as const),
      ...sample.sourceIds.map((s) => ["source", s] as const),
      ...sample.intents.map((i) => ["intent", i] as const),
    ];
    const seenInSample = new Set<string>();
    for (const [dimension, term] of terms) {
      const key = signalKey(dimension, term);
      if (seenInSample.has(key)) continue;
      seenInSample.add(key);
      const row = counts.get(key) ?? { dimension, positives: 0, negatives: 0 };
      if (positive) row.positives += 1;
      else row.negatives += 1;
      counts.set(key, row);
    }
  }

  return [...counts.entries()]
    .map(([key, row]) => ({
      key,
      dimension: row.dimension,
      positives: row.positives,
      negatives: row.negatives,
      evidence: row.positives + row.negatives,
      weight: signalWeight(row.positives, row.negatives, config),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Build one version of a workspace's preference model.
 * The model is inert unless the feature flag is on and the workspace has at
 * least `minWorkspaceEvidence` decisions, so ranking cannot change early.
 */
export function buildPreferenceModel(input: {
  workspaceId: string;
  version: number;
  samples: LearningSample[];
  config: LearningConfig;
  createdAt?: Date;
}): PreferenceModel {
  const scored = input.samples.filter((s) => s.decision !== "none");
  const positiveEvents = scored.filter((s) => s.decision === "positive").length;
  const negativeEvents = scored.length - positiveEvents;
  const weights = derivePreferenceSignals(input.samples, input.config);
  const hasSignal = weights.some((w) => w.weight !== 0);

  let disabledReason: PreferenceModel["disabledReason"] = null;
  if (!input.config.enabled) disabledReason = "flag_disabled";
  else if (scored.length < input.config.minWorkspaceEvidence) {
    disabledReason = "insufficient_evidence";
  } else if (!hasSignal) disabledReason = "no_signal";

  return {
    workspaceId: input.workspaceId,
    version: input.version,
    weights,
    positiveEvents,
    negativeEvents,
    evidence: scored.length,
    active: disabledReason === null,
    disabledReason,
    createdAt: (input.createdAt ?? new Date()).toISOString(),
  };
}

export function weightsByKey(
  weights: PreferenceWeight[],
): Map<string, PreferenceWeight> {
  return new Map(weights.map((w) => [w.key, w]));
}

/** Split `contentMd` / `content_md` / `content-md` into comparable parts. */
function fieldParts(field: string): string[] {
  return field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_\-.]+/)
    .filter(Boolean)
    .map((part) => part.toLowerCase());
}

/**
 * Refuse to persist anything that looks like collected content. Social content
 * is used only as the thing a decision was made *about*; the model stores
 * counts and bounded weights, never the post text, titles, or URLs.
 */
export function findRawContentLeakage(
  weights: Array<Record<string, unknown>>,
): string[] {
  const violations: string[] = [];
  for (const weight of weights) {
    const label = typeof weight.key === "string" ? weight.key : "<unknown>";
    if (typeof weight.key !== "string" || !KEY_PATTERN.test(weight.key)) {
      violations.push(`${label}: key is not a bounded <dimension>:<term> token`);
    }
    for (const [field, value] of Object.entries(weight)) {
      if (fieldParts(field).some((part) => FORBIDDEN_FIELD_PARTS.has(part))) {
        violations.push(`${label}: forbidden field "${field}"`);
        continue;
      }
      if (
        field !== "key" &&
        typeof value === "string" &&
        value.length > MAX_TERM_LENGTH
      ) {
        violations.push(
          `${label}: term "${field}" exceeds ${MAX_TERM_LENGTH} chars`,
        );
      }
      if (typeof value === "number" && !Number.isFinite(value)) {
        violations.push(`${label}: field "${field}" is not finite`);
      }
    }
  }
  return violations;
}