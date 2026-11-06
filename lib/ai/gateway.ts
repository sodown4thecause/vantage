import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createGateway, type LanguageModel } from "ai";

import {
  CLOUDFLARE_BASE,
  VERCEL_BASE,
  cloudflareConfig,
  gatewayBackend,
  gatewayRequestHeaders,
  type GatewayMeta,
} from "@/lib/ai/gateway-config";

export {
  gatewayBackend,
  gatewayConfigured,
  gatewayRequestHeaders,
  gatewayResponseInfo,
  type GatewayBackend,
  type GatewayMeta,
} from "@/lib/ai/gateway-config";

type Env = Record<string, string | undefined>;

/** The only place a model client is built. */
export function gatewayModel(modelId: string, meta: GatewayMeta, env: Env = process.env): LanguageModel {
  if (gatewayBackend(env) === "cloudflare") {
    const { accountId, gatewayId, token } = cloudflareConfig(env);
    const provider = createOpenAICompatible({
      name: "cloudflare-ai-gateway",
      baseURL: `${CLOUDFLARE_BASE}/${accountId}/${gatewayId}/compat`,
      apiKey: token,
      headers: gatewayRequestHeaders(meta, env),
    });
    return provider(meta.autoRouter ? "cloudflare/auto" : modelId);
  }
  const apiKey = env.AI_GATEWAY_API_KEY?.trim();
  if (!apiKey) throw new Error("AI_GATEWAY_API_KEY is not set");
  return createGateway({ apiKey })(modelId);
}

/**
 * For call sites that post to the gateway directly. Cloudflare's compat
 * endpoint serves chat completions only; the Responses API is Vercel-only here.
 */
export function gatewayFetch(
  meta: GatewayMeta,
  env: Env = process.env,
  kind: "chat" | "responses" = "chat",
): { url: string; headers: Record<string, string> } {
  if (gatewayBackend(env) === "cloudflare") {
    if (kind === "responses") throw new Error("Cloudflare AI Gateway does not serve the Responses API");
    const { accountId, gatewayId, token } = cloudflareConfig(env);
    return {
      url: `${CLOUDFLARE_BASE}/${accountId}/${gatewayId}/compat/chat/completions`,
      headers: { Authorization: `Bearer ${token}`, ...gatewayRequestHeaders(meta, env) },
    };
  }
  const apiKey = env.AI_GATEWAY_API_KEY?.trim();
  if (!apiKey) throw new Error("AI_GATEWAY_API_KEY is not set");
  return {
    url: `${VERCEL_BASE}/${kind === "responses" ? "responses" : "chat/completions"}`,
    headers: { Authorization: `Bearer ${apiKey}` },
  };
}

