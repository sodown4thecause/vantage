import { createGateway } from "ai";

export const DEFAULT_CONTENT_AGENT_MODEL = "anthropic/claude-sonnet-5.5";
const AGENT_ESTIMATE_USD = 0.15;

export type ContentAgentModels = { apiKey: string; model: string };

type Env = Record<string, string | undefined>;

export function contentAgentModels(env: Env = process.env): ContentAgentModels | null {
  const apiKey = env.AI_GATEWAY_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    model: env.CONTENT_AGENT_MODEL?.trim() || DEFAULT_CONTENT_AGENT_MODEL,
  };
}

export function createContentGatewayModel(models: ContentAgentModels) {
  return createGateway({ apiKey: models.apiKey })(models.model);
}

export function contentAgentEstimateUsd(): number {
  return AGENT_ESTIMATE_USD;
}

/** Known model cost, in USD. Unknown models use runPaidCall's conservative estimate. */
export function contentUsageCost(
  model: string,
  usage: { inputTokens?: number; outputTokens?: number; inputTokenDetails?: { cacheReadTokens?: number } },
): number | undefined {
  if (model !== DEFAULT_CONTENT_AGENT_MODEL) return undefined;
  if (typeof usage.inputTokens !== "number" || typeof usage.outputTokens !== "number") return undefined;
  const inputTokens = usage.inputTokens;
  const outputTokens = usage.outputTokens;
  const cached = Math.min(usage.inputTokenDetails?.cacheReadTokens ?? 0, inputTokens);
  if (![inputTokens, outputTokens, cached].every((value) => Number.isFinite(value) && value >= 0)) return undefined;
  return ((inputTokens - cached) * 2 + cached * 0.2 + outputTokens * 10) / 1_000_000;
}
