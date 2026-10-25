/*
 * Which models the SEO agent uses, read from the environment. This module must not import `ai`: the shell reads it on
 * every render to decide whether to show the SEO item, and the SDK is only needed for answers.
 */

export const DEFAULT_EXECUTOR_MODEL = "anthropic/claude-sonnet-5.5";
export const DEFAULT_CLASSIFIER_MODEL = "reflection/beam";

type Env = Record<string, string | undefined>;

export type SeoModels = {
  executor: string;
  classifier: string;
  /** Owner-facing writeup model; defaults to the executor when unset. */
  summarizer: string;
  fallback: string | null;
};

function nonBlank(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function executorModel(env: Env = process.env): string {
  return nonBlank(env.SEO_AGENT_MODEL) ?? DEFAULT_EXECUTOR_MODEL;
}

export function summarizerModel(env: Env = process.env): string {
  return nonBlank(env.SEO_SUMMARIZER_MODEL) ?? executorModel(env);
}

/** Null when the gateway key is blank, so the agent is off rather than failing per request. */
export function seoModels(env: Env = process.env): SeoModels | null {
  if (!nonBlank(env.AI_GATEWAY_API_KEY)) return null;
  return {
    executor: executorModel(env),
    classifier: nonBlank(env.SEO_CLASSIFIER_MODEL) ?? DEFAULT_CLASSIFIER_MODEL,
    summarizer: summarizerModel(env),
    fallback: nonBlank(env.SEO_AGENT_FALLBACK_MODEL),
  };
}

export { nonBlank };
