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
  opts: { pepper: string; origin: string; now: Date },
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
  return { ok: true, token };
}
