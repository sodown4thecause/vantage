/*
 * Gateway selection and request headers. This module must not import `ai`: the
 * shell reads it on every render to decide whether an agent is available.
 */

type Env = Record<string, string | undefined>;

export type GatewayBackend = "vercel" | "cloudflare";

/**
 * Per-request context. Metadata is capped at five entries by AI Gateway, so it
 * carries identifiers only: never emails, names or post text.
 */
export type GatewayMeta = {
  /** Short feature name, e.g. "seo.classify". */
  feature: string;
  workspaceId?: string | null;
  scanRunId?: string | null;
  chatId?: string | null;
  /**
   * Set only when the input holds no workspace data, or when the key includes
   * the workspace id. Everything else skips the cache.
   */
  cache?: { key: string; ttlSeconds: number } | null;
  /** SEO executor only, behind SEO_AUTO_ROUTER_ENABLED. */
  autoRouter?: boolean;
};

export const CLOUDFLARE_BASE = "https://gateway.ai.cloudflare.com/v1";
export const VERCEL_BASE = "https://ai-gateway.vercel.sh/v1";

/** Defaults to Vercel so production keeps today's behaviour until the flag flips. */
export function gatewayBackend(env: Env = process.env): GatewayBackend {
  return env.AI_GATEWAY_PROVIDER?.trim().toLowerCase() === "cloudflare" ? "cloudflare" : "vercel";
}

export function cloudflareConfig(env: Env) {
  const accountId = env.CF_AIG_ACCOUNT_ID?.trim();
  const gatewayId = env.CF_AIG_GATEWAY_ID?.trim();
  const token = env.CF_AIG_TOKEN?.trim();
  if (!accountId || !gatewayId || !token) throw new Error("Cloudflare AI Gateway is not configured");
  return { accountId, gatewayId, token };
}

/** True when the selected backend has the credentials it needs. */
export function gatewayConfigured(env: Env = process.env): boolean {
  if (gatewayBackend(env) === "cloudflare") {
    return Boolean(
      env.CF_AIG_ACCOUNT_ID?.trim() && env.CF_AIG_GATEWAY_ID?.trim() && env.CF_AIG_TOKEN?.trim(),
    );
  }
  return Boolean(env.AI_GATEWAY_API_KEY?.trim());
}

/** cf-aig-* headers. Metadata never exceeds five entries. */
export function gatewayRequestHeaders(meta: GatewayMeta, env: Env = process.env): Record<string, string> {
  const metadata: Record<string, string> = { feature: meta.feature };
  if (meta.workspaceId) metadata.workspaceId = meta.workspaceId;
  if (meta.scanRunId) metadata.scanRunId = meta.scanRunId;
  if (meta.chatId) metadata.chatId = meta.chatId;
  const headers: Record<string, string> = { "cf-aig-metadata": JSON.stringify(metadata) };
  if (meta.cache) {
    headers["cf-aig-cache-key"] = meta.cache.key;
    headers["cf-aig-cache-ttl"] = String(meta.cache.ttlSeconds);
  } else {
    headers["cf-aig-skip-cache"] = "true";
  }
  if (meta.autoRouter) {
    const allowed = env.CF_AIG_ALLOWED_MODELS?.trim();
    if (allowed) headers["cf-aig-allowed-models"] = allowed;
    if (meta.chatId) headers["cf-aig-session-id"] = meta.chatId;
  }
  return headers;
}

/** The model that actually served the call, and the gateway's request id. */
export function gatewayResponseInfo(
  headers: Headers | Record<string, string> | undefined,
): { servedModel: string | null; requestId: string | null } {
  const get = (name: string) =>
    headers instanceof Headers ? headers.get(name) : (headers?.[name] ?? null);
  return { servedModel: get("cf-aig-routed-model"), requestId: get("cf-aig-request-id") };
}
