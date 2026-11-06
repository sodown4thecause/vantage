import {
  agentAssertionKey,
  agentOrigin,
  agentRegistrationEnabled,
  agentTokenPepper,
} from "@/lib/agent/config";
import {
  exchangeAuthorizationCode,
  refreshAccessToken,
  type OAuthErrorBody,
  type TokenResult,
} from "@/lib/agent/oauth/flow";
import { drizzleAgentStore } from "@/lib/agent/oauth/store";
import {
  drizzleRegistrationStore,
  exchangeAssertion,
  exchangeClaimGrant,
} from "@/lib/agent/registration";
import { agentIpHash, agentRateLimit } from "@/lib/agent/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store", pragma: "no-cache" };

const fail = (status: number, body: OAuthErrorBody) => Response.json(body, { status, headers: NO_STORE });

export async function POST(req: Request) {
  if (!agentRegistrationEnabled()) return new Response("Not found", { status: 404 });
  const pepper = agentTokenPepper();
  const origin = agentOrigin();
  if (!pepper || !origin) return fail(503, { error: "server_error", error_description: "Not configured." });

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
  const isAssertionGrant = grantType === "urn:ietf:params:oauth:grant-type:jwt-bearer";
  const isClaimGrant = grantType === "urn:workos:agent-auth:grant-type:claim";
  // Agent grants carry no client: the assertion, claim token or registration is
  // the grant. A refresh of an agent token is therefore clientless too.
  if (!clientId && !isAssertionGrant && !isClaimGrant && grantType !== "refresh_token") {
    return fail(400, { error: "invalid_client", error_description: "client_id is required." });
  }

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
  } else if (isAssertionGrant) {
    const assertion = field("assertion");
    if (!assertion) {
      return fail(400, { error: "invalid_request", error_description: "assertion is required." });
    }
    const signingKey = agentAssertionKey();
    if (!signingKey) return fail(503, { error: "server_error", error_description: "Not configured." });
    outcome = await exchangeAssertion({
      store: { ...store, ...drizzleRegistrationStore() },
      assertion,
      signingKey,
      origin,
      pepper,
      clientId: clientId || null,
      now,
    });
  } else if (isClaimGrant) {
    const claimToken = field("claim_token");
    if (!claimToken) {
      return fail(400, { error: "invalid_request", error_description: "claim_token is required." });
    }
    outcome = await exchangeClaimGrant({
      store: { ...store, ...drizzleRegistrationStore() },
      claimToken,
      pepper,
      now,
    });
  } else {
    return fail(400, {
      error: "unsupported_grant_type",
      error_description:
        "Supported grants: authorization_code, refresh_token, urn:ietf:params:oauth:grant-type:jwt-bearer, urn:workos:agent-auth:grant-type:claim.",
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
