import {
  AGENT_ACCESS_TOKEN_TTL_SECONDS,
  AGENT_AUTHORIZATION_CODE_TTL_SECONDS,
  AGENT_READ_SCOPE,
  AGENT_REFRESH_TOKEN_TTL_SECONDS,
  AGENT_SCOPES,
  parseScopes,
  type AgentScope,
} from "@/lib/agent/config";
import { hashSecret, randomToken } from "@/lib/agent/crypto";
import { isValidCodeChallenge, verifyPkce } from "@/lib/agent/oauth/pkce";
import type { AgentStore, OAuthClientRecord } from "@/lib/agent/oauth/store";

export type AuthorizeRequest = {
  responseType: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state: string | null;
  scope: string | null;
};

export type AuthorizeValidation =
  | { ok: true; client: OAuthClientRecord; scopes: AgentScope[]; request: AuthorizeRequest }
  | { ok: false; error: string; description: string; redirectTo: string | null };

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};

export type OAuthErrorBody = { error: string; error_description: string };

export type TokenResult =
  | { ok: true; body: TokenResponse }
  | { ok: false; status: number; body: OAuthErrorBody };

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0]?.trim() ?? "";
  return value?.trim() ?? "";
}

/** Reads the authorize query. Returns null when a required parameter is missing. */
export function readAuthorizeRequest(
  input: Record<string, string | string[] | undefined>,
): AuthorizeRequest | null {
  const clientId = first(input.client_id);
  const redirectUri = first(input.redirect_uri);
  if (!clientId || !redirectUri) return null;
  return {
    responseType: first(input.response_type),
    clientId,
    redirectUri,
    codeChallenge: first(input.code_challenge),
    codeChallengeMethod: first(input.code_challenge_method) || "S256",
    state: first(input.state) || null,
    scope: first(input.scope) || null,
  };
}

export function buildErrorRedirect(
  redirectUri: string,
  error: string,
  description: string,
  state: string | null,
): string {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", description);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

/**
 * Validates an authorize request. A bad client or redirect URI must not redirect
 * (RFC 6749 §4.1.2.1): redirecting would let an attacker use this endpoint as an
 * open redirector. Everything after that point redirects with an error code.
 */
export async function validateAuthorizeRequest(
  store: AgentStore,
  request: AuthorizeRequest,
): Promise<AuthorizeValidation> {
  const client = await store.getClient(request.clientId);
  if (!client) {
    return { ok: false, error: "invalid_client", description: "Unknown client.", redirectTo: null };
  }
  if (!client.redirectUris.includes(request.redirectUri)) {
    return {
      ok: false,
      error: "invalid_request",
      description: "redirect_uri is not registered for this client.",
      redirectTo: null,
    };
  }
  const fail = (error: string, description: string): AuthorizeValidation => ({
    ok: false,
    error,
    description,
    redirectTo: buildErrorRedirect(request.redirectUri, error, description, request.state),
  });

  if (request.responseType !== "code") {
    return fail("unsupported_response_type", "Only response_type=code is supported.");
  }
  if (request.codeChallengeMethod !== "S256") {
    return fail("invalid_request", "code_challenge_method must be S256.");
  }
  if (!isValidCodeChallenge(request.codeChallenge)) {
    return fail("invalid_request", "code_challenge is missing or malformed.");
  }

  const allowed = client.scopes.length > 0 ? client.scopes : [...AGENT_SCOPES];
  const requested = request.scope ? parseScopes(request.scope) : (allowed as AgentScope[]);
  if (request.scope && requested.length === 0) {
    return fail("invalid_scope", "No requested scope is issued by this server.");
  }
  const scopes = requested.filter((scope) => allowed.includes(scope));
  if (scopes.length !== requested.length) {
    return fail("invalid_scope", "A requested scope is not registered for this client.");
  }
  return { ok: true, client, scopes, request };
}

/** Issues a single-use code. The raw value is returned once; only its hash is stored. */
export async function issueAuthorizationCode(
  store: AgentStore,
  input: {
    clientId: string;
    userId: string;
    workspaceId: string | null;
    scopes: AgentScope[];
    redirectUri: string;
    codeChallenge: string;
    pepper: string;
    now: Date;
  },
): Promise<string> {
  const code = randomToken("vac");
  await store.createAuthorizationCode({
    codeHash: await hashSecret(code, input.pepper),
    clientId: input.clientId,
    userId: input.userId,
    workspaceId: input.workspaceId,
    scopes: input.scopes,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    expiresAt: new Date(input.now.getTime() + AGENT_AUTHORIZATION_CODE_TTL_SECONDS * 1_000),
  });
  return code;
}

async function issueTokens(
  store: AgentStore,
  input: {
    clientId: string;
    userId: string | null;
    workspaceId: string | null;
    scopes: string[];
    pepper: string;
    now: Date;
    rotatedFrom?: string | null;
    familyId: string;
  },
): Promise<TokenResponse> {
  const accessToken = randomToken("vat");
  const refreshToken = randomToken("vrt");
  await store.createToken({
    tokenHash: await hashSecret(accessToken, input.pepper),
    kind: "access",
    clientId: input.clientId,
    userId: input.userId,
    workspaceId: input.workspaceId,
    scopes: input.scopes,
    expiresAt: new Date(input.now.getTime() + AGENT_ACCESS_TOKEN_TTL_SECONDS * 1_000),
    familyId: input.familyId,
  });
  await store.createToken({
    tokenHash: await hashSecret(refreshToken, input.pepper),
    kind: "refresh",
    clientId: input.clientId,
    userId: input.userId,
    workspaceId: input.workspaceId,
    scopes: input.scopes,
    expiresAt: new Date(input.now.getTime() + AGENT_REFRESH_TOKEN_TTL_SECONDS * 1_000),
    rotatedFrom: input.rotatedFrom ?? null,
    familyId: input.familyId,
  });
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: AGENT_ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: input.scopes.join(" "),
  };
}

const invalidGrant = (description: string): TokenResult => ({
  ok: false,
  status: 400,
  body: { error: "invalid_grant", error_description: description },
});

export async function exchangeAuthorizationCode(
  store: AgentStore,
  input: {
    clientId: string;
    code: string;
    redirectUri: string;
    codeVerifier: string;
    pepper: string;
    now: Date;
  },
): Promise<TokenResult> {
  const record = await store.consumeAuthorizationCode(
    await hashSecret(input.code, input.pepper),
    input.now,
  );
  if (!record) return invalidGrant("The authorization code is invalid, used or expired.");
  if (record.clientId !== input.clientId) return invalidGrant("The code was issued to another client.");
  if (record.redirectUri !== input.redirectUri) {
    return invalidGrant("redirect_uri does not match the authorization request.");
  }
  if (!(await verifyPkce(input.codeVerifier, record.codeChallenge))) {
    return invalidGrant("code_verifier does not match the code challenge.");
  }
  return {
    ok: true,
    body: await issueTokens(store, {
      clientId: record.clientId,
      userId: record.userId,
      workspaceId: record.workspaceId,
      scopes: record.scopes,
      pepper: input.pepper,
      now: input.now,
      familyId: crypto.randomUUID(),
    }),
  };
}

export async function refreshAccessToken(
  store: AgentStore,
  input: { clientId: string; refreshToken: string; pepper: string; now: Date },
): Promise<TokenResult> {
  const tokenHash = await hashSecret(input.refreshToken, input.pepper);
  const record = await store.findToken(tokenHash);
  if (!record || record.kind !== "refresh") return invalidGrant("Unknown refresh token.");
  if (record.clientId !== input.clientId) return invalidGrant("The token was issued to another client.");
  if (record.revokedAt) {
    // A rotated token was replayed. Either the client raced itself or a thief is
    // holding a copy, so revoke this grant's family: the next legitimate refresh
    // fails and the user re-authorizes, while other devices keep working.
    if (record.familyId) await store.revokeTokenFamily(record.familyId, input.now);
    return invalidGrant("The refresh token was already used; the session was revoked.");
  }
  if (record.expiresAt.getTime() <= input.now.getTime()) {
    return invalidGrant("The refresh token is expired or revoked.");
  }
  // Revoke first: the conditional update is what makes rotation single-use under
  // concurrency. A second caller with the same token loses the race and fails.
  if (!(await store.revokeToken(tokenHash, input.now))) {
    return invalidGrant("The refresh token was already used.");
  }
  return {
    ok: true,
    body: await issueTokens(store, {
      clientId: record.clientId,
      userId: record.userId,
      workspaceId: record.workspaceId,
      scopes: record.scopes,
      pepper: input.pepper,
      now: input.now,
      rotatedFrom: record.id,
      familyId: record.familyId ?? crypto.randomUUID(),
    }),
  };
}

/** RFC 7009. Returns whether a live token was actually revoked. */
export async function revokeToken(
  store: AgentStore,
  input: { token: string; pepper: string; now: Date },
): Promise<boolean> {
  return store.revokeToken(await hashSecret(input.token, input.pepper), input.now);
}

/** Default scope set for a client that registers without asking for one. */
export const DEFAULT_CLIENT_SCOPES: AgentScope[] = [AGENT_READ_SCOPE];
