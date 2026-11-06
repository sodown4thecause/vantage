import { AGENT_DRAFT_SCOPE } from "@/lib/agent/config";
import { hashSecret } from "@/lib/agent/crypto";
import type { AgentStore, TokenRecord } from "@/lib/agent/oauth/store";

export type McpAuth =
  | { ok: true; token: TokenRecord }
  | { ok: false; status: 401 | 503; challenge?: string; body: { error: string } };

export function resourceMetadataUrl(origin: string): string {
  return `${origin}/.well-known/oauth-protected-resource`;
}

/**
 * Verifies the bearer token on an MCP request. A 401 always carries the
 * `resource_metadata` pointer, which is how an MCP client discovers where to
 * authenticate (RFC 9728).
 */
export async function authenticateMcpRequest(
  req: Request,
  store: AgentStore,
  opts: {
    pepper: string;
    origin: string;
    now: Date;
    /** Registration status for an agent token, or null when the row is gone. */
    registrationStatus?: (registrationId: string) => Promise<string | null>;
  },
): Promise<McpAuth> {
  if (!opts.pepper) return { ok: false, status: 503, body: { error: "not_configured" } };

  const challenge = `Bearer resource_metadata="${resourceMetadataUrl(opts.origin)}"`;
  const header = req.headers.get("authorization")?.trim() ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) return { ok: false, status: 401, challenge, body: { error: "unauthorized" } };

  const token = await store.findToken(await hashSecret(match[1]!, opts.pepper));
  if (
    !token ||
    token.kind !== "access" ||
    token.revokedAt !== null ||
    token.expiresAt.getTime() <= opts.now.getTime()
  ) {
    return { ok: false, status: 401, challenge, body: { error: "invalid_token" } };
  }

  // A token insert can race the claim: it may have read `active` before the
  // transfer and land after the revocation. Checking the registration here, at
  // use time, closes that window whatever the insert order was.
  if (token.registrationId && opts.registrationStatus) {
    const status = await opts.registrationStatus(token.registrationId);
    const preClaim = !token.scopes.includes(AGENT_DRAFT_SCOPE);
    if (status === null || status === "expired" || status === "revoked") {
      return { ok: false, status: 401, challenge, body: { error: "invalid_token" } };
    }
    if (status === "claimed" && preClaim) {
      return { ok: false, status: 401, challenge, body: { error: "invalid_token" } };
    }
  }
  return { ok: true, token };
}
