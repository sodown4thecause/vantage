/**
 * Shared types for the Grok X reliability experiment.
 *
 * A "run" is one scan: one topic, one model call, one deterministic JSON file.
 * Two runs can be diffed to measure how much Grok's recall fluctuates over time.
 *
 * This folder is intentionally OUTSIDE the product code path. It must not be
 * imported by app code, schemas, migrations, or tests.
 */

/** Where the model call was actually served. */
export type RunEndpoint = "ai-gateway" | "xai-direct";

/** A cited X/Twitter post extracted from a scan. */
export type CitedPost = {
  /** Stable id when exposed by the model; otherwise a derived slug from the url. */
  id: string;
  /** Canonical post url, or null when the model only gave a handle/number. */
  url: string | null;
  /** Author handle without a leading "@", when exposed. */
  author: string | null;
  /** Post text or the best available snippet. */
  text: string;
  /** ISO 8601 timestamp when the model exposed a posted-at value. */
  postedAt: string | null;
};

/** Model usage as reported by the provider, normalized to a stable shape. */
export type RunUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  totalTokens: number | null;
  /** Raw provider usage blob for provenance; never used for logic. */
  raw: unknown;
};

/** The gateway pricing we use to estimate cost when the provider reports none. */
export type ModelPricing = {
  /** USD per 1M input tokens under the standard context tier. */
  inputPerMillion: number;
  /** USD per 1M input tokens above the long-context threshold. */
  inputPerMillionLongContext: number;
  /** USD per 1M output tokens under the standard context tier. */
  outputPerMillion: number;
  /** USD per 1M output tokens above the long-context threshold. */
  outputPerMillionLongContext: number;
  /** USD per 1M cached input-read tokens under the standard context tier. */
  cachedInputReadPerMillion: number;
  /** USD per 1M cached input-read tokens above the long-context threshold. */
  cachedInputReadPerMillionLongContext: number;
  /** Token count at which the long-context (higher) pricing applies. */
  longContextThreshold: number;
  /** Total context window in tokens. */
  contextWindow: number;
};

/** A best-effort cost estimate derived from usage tokens and published pricing. */
export type CostEstimate = {
  /** Estimated USD cost, or null when usage tokens were unavailable. */
  usd: number | null;
  /** True when any token bucket used long-context pricing. */
  longContext: boolean;
  /** The pricing table applied, for provenance. */
  pricing: ModelPricing | null;
};

/**
 * Published Vercel AI Gateway pricing for `spacexai/grok-4.7` (as of this
 * experiment). Recorded in each run for provenance; never used as product
 * prices.
 */
export const GROK_4_7_PRICING: ModelPricing = {
  inputPerMillion: 2,
  inputPerMillionLongContext: 4,
  outputPerMillion: 6,
  outputPerMillionLongContext: 12,
  cachedInputReadPerMillion: 0.5,
  cachedInputReadPerMillionLongContext: 1,
  longContextThreshold: 200_000,
  contextWindow: 500_000,
};

/** The exact request we sent, minus secrets. Kept for reproducibility. */
export type RunRequest = {
  endpoint: string;
  model: string;
  topic: string;
  fromDate: string | null;
  /** The full JSON body we POSTed, with any key material removed. */
  body: unknown;
};

/** The normalized result of one model call. */
export type RunResponse = {
  /** The model's natural-language summary, or null when it returned none. */
  text: string | null;
  /** Any structured citations the provider returned, verbatim. */
  citations: unknown[];
  /** Posts parsed out of the summary + citations. */
  posts: CitedPost[];
  usage: RunUsage;
  /**
   * Best-effort cost in USD: the provider-reported value when present,
   * otherwise our estimate from usage tokens and published pricing.
   */
  costUsd: number | null;
  /** How the cost was derived, with the pricing table applied. */
  cost: CostEstimate;
};

/** One scan, as written to runs/<ISO-timestamp>.json. */
export type RunRecord = {
  /** Derived from startedAt; stable and sortable. */
  runId: string;
  /** ISO 8601 timestamp of when the scan started. */
  startedAt: string;
  topic: string;
  model: string;
  endpoint: RunEndpoint;
  request: RunRequest;
  response: RunResponse;
  status: "ok" | "error";
  /** Error message when status is "error"; null on success. */
  error: string | null;
};

/** The diff between an earlier run and a later run. */
export type RunDiff = {
  earlierRunId: string;
  laterRunId: string;
  /** Posts present in the later run whose thread url was absent earlier. */
  newPosts: CitedPost[];
  /** Posts present in the earlier run whose thread url is absent later. */
  disappearedPosts: CitedPost[];
  /** Posts present in both runs. */
  retainedPosts: CitedPost[];
  earlierPostCount: number;
  laterPostCount: number;
  /** retained / max(earlier, later); 1 means perfect overlap. */
  overlapRatio: number;
};
