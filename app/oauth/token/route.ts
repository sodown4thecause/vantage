import { agentOrigin, agentRegistrationEnabled, agentTokenPepper } from "@/lib/agent/config";
import {
  exchangeAuthorizationCode,
  refreshAccessToken,
  type OAuthErrorBody,
  type TokenResult,
} from "@/lib/agent/oauth/flow";
import { drizzleAgentStore } from "@/lib/agent/oauth/store";
import { agentIpHash, agentRateLimit } from "@/lib/agent/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store", pragma: "no-cache" };

const fail = (status: number, body: OAuthErrorBody) => Response.json(body, { status, headers: NO_STORE });

export async function POST(req: Request) {
  if (!agentRegistrationEnabled()) return new Response("Not found", { status: 404 });
  const pepper = agentTokenPepper();
  if (!pepper || !agentOrigin()) return fail(503, { error: "server_error", error_description: "Not configured." });

  const ipHash = await agentIpHash(req);
  if (!(await agentRateLimit("agent-token", ipHash ?? "unknown"))) {
    return Response.json(
      { error: "rate_limited", error_description: "Too many token requests." },
      { status: 429, headers: { ...NO_STORE, "retry-after": "30" } },
    );
  }

  const form = await req.formData().catch(() => null);
  if (!form) return fail(400, { error: "invalid_request", error_description: "A form body is required." });
  const field = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value.trim() : "";
  };

  const grantType = field("grant_type");
  const clientId = field("client_id");
  if (!clientId) return fail(400, { error: "invalid_client", error_description: "client_id is required." });

  const store = drizzleAgentStore();
  const now = new Date();
  let outcome: TokenResult;

  if (grantType === "authorization_code") {
    const code = field("code");
    const redirectUri = field("redirect_uri");
    const codeVerifier = field("code_verifier");
    if (!code || !redirectUri || !codeVerifier) {
      return fail(400, {
        error: "invalid_request",
        error_description: "code, redirect_uri and code_verifier are required.",
      });
    }
    outcome = await exchangeAuthorizationCode(store, {
      clientId,
      code,
      redirectUri,
      codeVerifier,
      pepper,
      now,
    });
  } else if (grantType === "refresh_token") {
    const refreshToken = field("refresh_token");
    if (!refreshToken) {
      return fail(400, { error: "invalid_request", error_description: "refresh_token is required." });
    }
    outcome = await refreshAccessToken(store, { clientId, refreshToken, pepper, now });
  } else {
    return fail(400, {
      error: "unsupported_grant_type",
      error_description: "Supported grants: authorization_code, refresh_token.",
    });
  }

  if (!outcome.ok) {
    await store.audit({
      event: "token_denied",
      clientId,
      ipHash,
      detail: { grantType, error: outcome.body.error },
    });
    return fail(outcome.status, outcome.body);
  }

  await store.audit({
    event: "token_issued",
    clientId,
    ipHash,
    detail: { grantType, scope: outcome.body.scope },
  });
  return Response.json(outcome.body, { headers: NO_STORE });
}
