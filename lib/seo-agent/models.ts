import { createGateway } from "ai";

export const DEFAULT_EXECUTOR_MODEL = "anthropic/claude-sonnet-5.5";
export const DEFAULT_CLASSIFIER_MODEL = "reflection/beam";

type Env = Record<string, string | undefined>;

export type SeoModels = { executor: string; classifier: string; fallback: string | null };
export type ModelPrice = { input: number; output: number; cacheRead?: number };
export type UsageTokens = { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number };

/** USD per million tokens. Other models are priced from SEO_MODEL_PRICES_JSON; an unpriced model has no cost. */
export const MODEL_PRICES_PER_MTOK: Record<string, ModelPrice> = {
  "anthropic/claude-sonnet-5.5": { input: 2, output: 10, cacheRead: 0.2 },
};

function nonBlank(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function executorModel(env: Env): string {
  return nonBlank(env.SEO_AGENT_MODEL) ?? DEFAULT_EXECUTOR_MODEL;
}

/** Null when the gateway key is blank, so the agent is off rather than failing per request. */
export function seoModels(env: Env = process.env): SeoModels | null {
  if (!nonBlank(env.AI_GATEWAY_API_KEY)) return null;
  return {
    executor: executorModel(env),
    classifier: nonBlank(env.SEO_CLASSIFIER_MODEL) ?? DEFAULT_CLASSIFIER_MODEL,
    fallback: nonBlank(env.SEO_AGENT_FALLBACK_MODEL),
  };
}

export function gatewayProvider(env: Env = process.env) {
  const apiKey = nonBlank(env.AI_GATEWAY_API_KEY);
  if (!apiKey) throw new Error("AI_GATEWAY_API_KEY is not set");
  return createGateway({ apiKey });
}

/**
 * Sent on every classifier-model call. The gateway tries the executor model when the classifier id
 * is unknown or unavailable, so a bad SEO_CLASSIFIER_MODEL degrades instead of failing the question.
 */
export function classifierProviderOptions(env: Env = process.env): { gateway: { models: string[]; speed?: string } } {
  const speed = nonBlank(env.SEO_CLASSIFIER_SPEED);
  return { gateway: { models: [executorModel(env)], ...(speed ? { speed } : {}) } };
}

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

function parsePrice(value: unknown): ModelPrice | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { input, output, cacheRead } = value as Record<string, unknown>;
  if (!isCount(input) || !isCount(output)) return null;
  if (cacheRead !== undefined && !isCount(cacheRead)) return null;
  return { input, output, ...(cacheRead === undefined ? {} : { cacheRead }) };
}

/** Defaults merged with SEO_MODEL_PRICES_JSON. Malformed JSON or entries are ignored, leaving those models unpriced. */
function priceTable(env: Env): Record<string, ModelPrice> {
  const raw = nonBlank(env.SEO_MODEL_PRICES_JSON);
  if (!raw) return MODEL_PRICES_PER_MTOK;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return MODEL_PRICES_PER_MTOK; }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return MODEL_PRICES_PER_MTOK;
  const overrides: Record<string, ModelPrice> = {};
  for (const [model, value] of Object.entries(parsed)) {
    const price = parsePrice(value);
    if (price) overrides[model] = price;
  }
  return { ...MODEL_PRICES_PER_MTOK, ...overrides };
}

/**
 * USD for one call, or undefined when the model is unpriced or usage is incomplete (runPaidCall then charges the estimate).
 * `inputTokens` includes cached tokens, as the AI SDK reports it, so only the uncached remainder bills at the input rate.
 */
export function costOfUsage(model: string, usage: UsageTokens, env: Env = process.env): number | undefined {
  const table = priceTable(env);
  if (!Object.hasOwn(table, model)) return undefined;
  const price = table[model];
  const { inputTokens, outputTokens } = usage;
  if (!price || !isCount(inputTokens) || !isCount(outputTokens)) return undefined;
  const cached = Math.min(isCount(usage.cachedInputTokens) ? usage.cachedInputTokens : 0, inputTokens);
  const cost = (
    (inputTokens - cached) * price.input
    + cached * (price.cacheRead ?? price.input)
    + outputTokens * price.output
  ) / 1_000_000;
  return Number.isFinite(cost) ? cost : undefined;
}
