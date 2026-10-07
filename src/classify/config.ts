// ---------------------------------------------------------------------------
// Classifier configuration, parsed from env at the boundary.
//
// Why a module: env values are strings decided by operators. Parsing them once
// into a trusted, typed config keeps defaults, clamps, and the enabled flag in
// one auditable place. Illegal states (negative batch size, etc.) are corrected
// to safe defaults rather than crashing the queue.
// ---------------------------------------------------------------------------
import type { Env } from "../types";

/** Exact "DeepSeek V4.1 Flash" id on the `inco` host, verified against
 *  `GET https://api.inco.ai/v1/models` on 2026-10-07 (id: `deepseek-v4.1-flash`). */
export const DEFAULT_CLASSIFIER_MODEL = "deepseek-v4.1-flash";

/** Exact "Kimi K3" id, verified the same way (id: `kimi-k3`). Writer seam only. */
export const DEFAULT_WRITER_MODEL = "kimi-k3";

export const DEFAULT_BATCH_SIZE = 15;
export const DEFAULT_MAX_ITEMS_PER_MESSAGE = 60;
export const DEFAULT_MAX_CONCURRENCY = 2;

/** Trusted classifier runtime config. */
export interface ClassifierConfig {
  readonly enabled: boolean;
  readonly model: string;
  readonly writerModel: string;
  readonly batchSize: number;
  readonly maxItemsPerMessage: number;
  readonly maxConcurrency: number;
}

/** Parse a positive integer env var, or return the fallback on garbage/absence. */
function positiveIntOr(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** `"false"` (case-insensitive) disables; anything else (or absent) enables. */
function enabledFlag(value: string | undefined): boolean {
  return (value ?? "true").trim().toLowerCase() !== "false";
}

/**
 * Build the classifier config from env. Pure and deterministic.
 *
 * `maxItemsPerMessage` is always >= `batchSize` so a message can always classify
 * at least one full batch.
 */
export function getClassifierConfig(env: Env): ClassifierConfig {
  const batchSize = positiveIntOr(env.CLASSIFIER_BATCH_SIZE, DEFAULT_BATCH_SIZE);
  const maxItemsPerMessage = Math.max(
    batchSize,
    positiveIntOr(env.CLASSIFIER_MAX_ITEMS_PER_MESSAGE, DEFAULT_MAX_ITEMS_PER_MESSAGE),
  );
  return {
    enabled: enabledFlag(env.CLASSIFIER_ENABLED),
    model: env.INCO_CLASSIFIER_MODEL?.trim() || DEFAULT_CLASSIFIER_MODEL,
    writerModel: env.INCO_WRITER_MODEL?.trim() || DEFAULT_WRITER_MODEL,
    batchSize,
    maxItemsPerMessage,
    maxConcurrency: positiveIntOr(env.CLASSIFIER_MAX_CONCURRENCY, DEFAULT_MAX_CONCURRENCY),
  };
}
