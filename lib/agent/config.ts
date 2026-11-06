/**
 * Agent access (auth.md + MCP) configuration. Everything here is inert unless
 * `AGENT_REGISTRATION_ENABLED` is exactly "true" and the deployment is not
 * production, so a copied variable cannot open the feature in production.
 */

export const AGENT_READ_SCOPE = "vantage.read";
export const AGENT_DRAFT_SCOPE = "vantage.draft";
export const AGENT_SCOPES = [AGENT_READ_SCOPE, AGENT_DRAFT_SCOPE] as const;
export type AgentScope = (typeof AGENT_SCOPES)[number];

/** An anonymous, unclaimed agent may read. Drafting unlocks when a human claims it. */
export const AGENT_PRE_CLAIM_SCOPES: readonly AgentScope[] = [AGENT_READ_SCOPE];
export const AGENT_POST_CLAIM_SCOPES: readonly AgentScope[] = [AGENT_READ_SCOPE, AGENT_DRAFT_SCOPE];

export const AGENT_ACCESS_TOKEN_TTL_SECONDS = 3_600;
export const AGENT_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 3_600;
export const AGENT_AUTHORIZATION_CODE_TTL_SECONDS = 600;
export const AGENT_MAX_REDIRECT_URIS = 5;

/** Anonymous trial limits. Lifetime counters, because a trial lasts seven days. */
export const AGENT_TRIAL_DAYS = 7;
export const AGENT_TRIAL_TOOL_CALLS = 100;
export const AGENT_TRIAL_DRAFT_ATTEMPTS = 10;
export const AGENT_TRIAL_SCANS = 1;
export const AGENT_TRIAL_MAX_PER_IP_PER_DAY = 3;
export const AGENT_TRIAL_MAX_PER_DAY = 50;
export const AGENT_ASSERTION_TTL_SECONDS = 900;
export const AGENT_USER_CODE_TTL_SECONDS = 600;
export const AGENT_CLAIM_POLL_INTERVAL_SECONDS = 5;

export function isAgentScope(value: unknown): value is AgentScope {
  return typeof value === "string" && (AGENT_SCOPES as readonly string[]).includes(value);
}

/** Keeps only scopes this server issues, in canonical order. Unknown scopes are dropped. */
export function parseScopes(raw: string | null | undefined): AgentScope[] {
  if (!raw) return [];
  const requested = new Set(raw.split(/\s+/).filter(Boolean));
  return AGENT_SCOPES.filter((scope) => requested.has(scope));
}

type Env = Record<string, string | undefined>;

export function agentRegistrationEnabled(env: Env = process.env): boolean {
  if (env.AGENT_REGISTRATION_ENABLED?.trim() !== "true") return false;
  const deployEnv =
    env.VANTAGE_DEPLOY_ENV?.trim() ||
    (env.NODE_ENV === "production" ? "production" : "development");
  return deployEnv !== "production";
}

/** Public origin for metadata, claim links and redirects. Empty means "not configured". */
export function agentOrigin(env: Env = process.env): string {
  const configured = env.AGENT_REGISTRATION_ORIGIN?.trim() || env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return env.NODE_ENV === "production" ? "" : "http://localhost:3000";
}

/**
 * Pepper for hashing tokens and codes. Production fails closed without it; local
 * development uses a fixed value so the feature can be exercised without secrets.
 */
export function agentTokenPepper(env: Env = process.env): string {
  const configured = env.AGENT_TOKEN_PEPPER?.trim();
  if (configured) return configured;
  return env.NODE_ENV === "production" ? "" : "dev-agent-pepper";
}

/**
 * Signing secret for anonymous identity assertions. HMAC rather than an
 * asymmetric key: only Vantage verifies its own assertions, so a key pair would
 * add key management without adding a security boundary.
 */
export function agentAssertionKey(env: Env = process.env): string {
  const configured = env.AGENT_ASSERTION_SIGNING_KEY?.trim();
  if (configured) return configured;
  return env.NODE_ENV === "production" ? "" : "dev-agent-assertion-key";
}

export function agentAssertionKeyId(env: Env = process.env): string {
  return env.AGENT_ASSERTION_KEY_ID?.trim() || "vantage-agent-1";
}
