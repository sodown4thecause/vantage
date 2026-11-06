import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ store: null as unknown }));

vi.mock("@/lib/agent/oauth/store", () => ({
  drizzleAgentStore: () => state.store,
}));

import {
  AGENT_READ_SCOPE,
  agentOrigin,
  agentRegistrationEnabled,
  agentTokenPepper,
  parseScopes,
} from "@/lib/agent/config";
import { base64Url, hashSecret, randomUserCode, timingSafeEqual } from "@/lib/agent/crypto";
import { authenticateMcpRequest } from "@/lib/agent/mcp/auth";
import { handleMcpMessage, type McpTool } from "@/lib/agent/mcp/protocol";
import { agentTools } from "@/lib/agent/mcp/tools";
import {
  exchangeAuthorizationCode,
  issueAuthorizationCode,
  readAuthorizeRequest,
  refreshAccessToken,
  revokeToken,
  validateAuthorizeRequest,
} from "@/lib/agent/oauth/flow";
import { authMarkdown, authorizationServerMetadata, protectedResourceMetadata } from "@/lib/agent/oauth/metadata";
import { isValidCodeVerifier, verifyPkce } from "@/lib/agent/oauth/pkce";
import { isAllowedRedirectUri, normalizeRedirectUris } from "@/lib/agent/oauth/redirect";
import type { AgentStore, AuditEntry, OAuthClientRecord } from "@/lib/agent/oauth/store";

const PEPPER = "test-pepper";
const ORIGIN = "https://staging.example.com";
const REDIRECT = "https://client.example.com/callback";

type FakeCode = {
  clientId: string;
  userId: string;
  workspaceId: string | null;
  scopes: string[];
  redirectUri: string;
  codeChallenge: string;
  expiresAt: Date;
  consumedAt: Date | null;
};

type FakeToken = {
  id: string;
  kind: "access" | "refresh";
  clientId: string | null;
  userId: string | null;
  workspaceId: string | null;
  registrationId: string | null;
  scopes: string[];
  expiresAt: Date;
  revokedAt: Date | null;
  familyId: string | null;
};

function createFakeStore() {
  const clients = new Map<string, OAuthClientRecord>();
  const codes = new Map<string, FakeCode>();
  const tokens = new Map<string, FakeToken>();
  const audits: AuditEntry[] = [];
  let sequence = 0;

  const store: AgentStore & { clients: typeof clients; codes: typeof codes; tokens: typeof tokens; audits: typeof audits } = {
    clients,
    codes,
    tokens,
    audits,
    async getClient(clientId) {
      return clients.get(clientId) ?? null;
    },
    async createClient(input) {
      clients.set(input.id, input);
    },
    async createAuthorizationCode(input) {
      codes.set(input.codeHash, { ...input, consumedAt: null });
    },
    async consumeAuthorizationCode(codeHash, now) {
      const row = codes.get(codeHash);
      if (!row || row.consumedAt || row.expiresAt.getTime() <= now.getTime()) return null;
      row.consumedAt = now;
      sequence += 1;
      return {
        id: `code_${sequence}`,
        clientId: row.clientId,
        userId: row.userId,
        workspaceId: row.workspaceId,
        scopes: row.scopes,
        redirectUri: row.redirectUri,
        codeChallenge: row.codeChallenge,
      };
    },
    async createToken(input) {
      sequence += 1;
      tokens.set(input.tokenHash, {
        id: `tok_${sequence}`,
        kind: input.kind,
        clientId: input.clientId,
        userId: input.userId,
        workspaceId: input.workspaceId,
        registrationId: input.registrationId ?? null,
        scopes: input.scopes,
        expiresAt: input.expiresAt,
        revokedAt: null,
        familyId: input.familyId,
      });
    },
    async findToken(tokenHash) {
      return tokens.get(tokenHash) ?? null;
    },
    async revokeToken(tokenHash, now) {
      const row = tokens.get(tokenHash);
      if (!row || row.revokedAt) return false;
      row.revokedAt = now;
      return true;
    },
    async revokeTokenFamily(familyId, now) {
      let revoked = 0;
      for (const row of tokens.values()) {
        if (row.familyId === familyId && !row.revokedAt) {
          row.revokedAt = now;
          revoked += 1;
        }
      }
      return revoked;
    },
    async revokeTokensForSubject(input, now) {
      let revoked = 0;
      for (const row of tokens.values()) {
        if (
          row.clientId === input.clientId &&
          row.userId === input.userId &&
          row.workspaceId === input.workspaceId &&
          !row.revokedAt
        ) {
          row.revokedAt = now;
          revoked += 1;
        }
      }
      return revoked;
    },
    async audit(entry) {
      audits.push(entry);
    },
  };
  return store;
}

async function pkcePair(verifier = "a".repeat(43)) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

async function seedClient(store: ReturnType<typeof createFakeStore>) {
  await store.createClient({
    id: "vcl_test",
    name: "Claude Code",
    redirectUris: [REDIRECT],
    scopes: ["vantage.read", "vantage.draft"],
  });
}

const authorizeQuery = (challenge: string) => ({
  response_type: "code",
  client_id: "vcl_test",
  redirect_uri: REDIRECT,
  code_challenge: challenge,
  code_challenge_method: "S256",
  state: "xyz",
  scope: "vantage.read",
});

beforeEach(() => {
  state.store = createFakeStore();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("feature flag", () => {
  it("is off unless the flag is exactly true", () => {
    expect(agentRegistrationEnabled({})).toBe(false);
    expect(agentRegistrationEnabled({ AGENT_REGISTRATION_ENABLED: "1" })).toBe(false);
    expect(agentRegistrationEnabled({ AGENT_REGISTRATION_ENABLED: "true" })).toBe(true);
  });

  it("refuses production even when the flag is set", () => {
    expect(
      agentRegistrationEnabled({
        AGENT_REGISTRATION_ENABLED: "true",
        VANTAGE_DEPLOY_ENV: "production",
      }),
    ).toBe(false);
    expect(
      agentRegistrationEnabled({
        AGENT_REGISTRATION_ENABLED: "true",
        VANTAGE_DEPLOY_ENV: "staging",
      }),
    ).toBe(true);
  });

  it("prefers the configured origin and falls back to the app URL", () => {
    expect(agentOrigin({ AGENT_REGISTRATION_ORIGIN: "https://a.example.com/" })).toBe(
      "https://a.example.com",
    );
    expect(agentOrigin({ NEXT_PUBLIC_APP_URL: "https://b.example.com" })).toBe(
      "https://b.example.com",
    );
    expect(agentOrigin({ NODE_ENV: "production" })).toBe("");
  });

  it("fails closed on the token pepper in production", () => {
    expect(agentTokenPepper({ NODE_ENV: "production" })).toBe("");
    expect(agentTokenPepper({ NODE_ENV: "test" })).not.toBe("");
  });

  it("keeps only scopes this server issues", () => {
    expect(parseScopes("vantage.read admin.write")).toEqual(["vantage.read"]);
    expect(parseScopes("")).toEqual([]);
  });
});

describe("crypto", () => {
  it("compares in constant time without throwing on length mismatch", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });

  it("generates six-digit codes", () => {
    for (let index = 0; index < 50; index += 1) {
      expect(randomUserCode()).toMatch(/^\d{6}$/);
    }
  });
});

describe("PKCE", () => {
  it("accepts a matching S256 verifier", async () => {
    const { verifier, challenge } = await pkcePair();
    expect(await verifyPkce(verifier, challenge)).toBe(true);
  });

  it("rejects a wrong or malformed verifier", async () => {
    const { challenge } = await pkcePair();
    expect(await verifyPkce("b".repeat(43), challenge)).toBe(false);
    expect(await verifyPkce("short", challenge)).toBe(false);
    expect(isValidCodeVerifier("a".repeat(42))).toBe(false);
    expect(isValidCodeVerifier("a".repeat(43))).toBe(true);
  });
});

describe("redirect URIs", () => {
  it("allows https and loopback http only", () => {
    expect(isAllowedRedirectUri("https://client.example.com/cb")).toBe(true);
    expect(isAllowedRedirectUri("http://localhost:33418/callback")).toBe(true);
    expect(isAllowedRedirectUri("http://127.0.0.1:8080/cb")).toBe(true);
    expect(isAllowedRedirectUri("http://client.example.com/cb")).toBe(false);
    expect(isAllowedRedirectUri("https://client.example.com/cb#frag")).toBe(false);
    expect(isAllowedRedirectUri("https://user:pass@client.example.com/cb")).toBe(false);
    expect(isAllowedRedirectUri("not a url")).toBe(false);
  });

  it("rejects empty, oversized and partly invalid lists", () => {
    expect(normalizeRedirectUris([])).toBeNull();
    expect(normalizeRedirectUris(["https://a.example.com/cb", "http://evil.example.com/cb"])).toBeNull();
    expect(normalizeRedirectUris(Array.from({ length: 6 }, (_, i) => `https://a.example.com/${i}`))).toBeNull();
    expect(normalizeRedirectUris(["https://a.example.com/cb", "https://a.example.com/cb"])).toEqual([
      "https://a.example.com/cb",
    ]);
  });
});

describe("authorize request", () => {
  it("does not redirect when the client or redirect URI is unknown", async () => {
    const store = state.store as ReturnType<typeof createFakeStore>;
    const { challenge } = await pkcePair();

    const unknownClient = await validateAuthorizeRequest(store, {
      ...readAuthorizeRequest(authorizeQuery(challenge))!,
      clientId: "vcl_missing",
    });
    expect(unknownClient.ok).toBe(false);
    if (!unknownClient.ok) expect(unknownClient.redirectTo).toBeNull();

    await seedClient(store);
    const badRedirect = await validateAuthorizeRequest(store, {
      ...readAuthorizeRequest(authorizeQuery(challenge))!,
      redirectUri: "https://attacker.example.com/cb",
    });
    expect(badRedirect.ok).toBe(false);
    if (!badRedirect.ok) expect(badRedirect.redirectTo).toBeNull();
  });

  it("redirects with an error for a bad response type, method or challenge", async () => {
    const store = state.store as ReturnType<typeof createFakeStore>;
    await seedClient(store);
    const { challenge } = await pkcePair();
    const base = readAuthorizeRequest(authorizeQuery(challenge))!;

    for (const request of [
      { ...base, responseType: "token" },
      { ...base, codeChallengeMethod: "plain" },
      { ...base, codeChallenge: "" },
    ]) {
      const outcome = await validateAuthorizeRequest(store, request);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.redirectTo).toContain("error=");
        expect(outcome.redirectTo).toContain("state=xyz");
      }
    }
  });

  it("refuses a scope the client did not register", async () => {
    const store = state.store as ReturnType<typeof createFakeStore>;
    await store.createClient({
      id: "vcl_test",
      name: "Read only",
      redirectUris: [REDIRECT],
      scopes: ["vantage.read"],
    });
    const { challenge } = await pkcePair();
    const outcome = await validateAuthorizeRequest(store, {
      ...readAuthorizeRequest(authorizeQuery(challenge))!,
      scope: "vantage.draft",
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toBe("invalid_scope");
  });

  it("accepts a well-formed request", async () => {
    const store = state.store as ReturnType<typeof createFakeStore>;
    await seedClient(store);
    const { challenge } = await pkcePair();
    const outcome = await validateAuthorizeRequest(
      store,
      readAuthorizeRequest(authorizeQuery(challenge))!,
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.scopes).toEqual(["vantage.read"]);
  });
});

describe("token exchange", () => {
  async function issueCode(store: ReturnType<typeof createFakeStore>) {
    const { verifier, challenge } = await pkcePair();
    const code = await issueAuthorizationCode(store, {
      clientId: "vcl_test",
      userId: "user_1",
      workspaceId: "11111111-1111-4111-8111-111111111111",
      scopes: ["vantage.read"],
      redirectUri: REDIRECT,
      codeChallenge: challenge,
      pepper: PEPPER,
      now: new Date("2026-11-06T00:00:00Z"),
    });
    return { code, verifier };
  }

  it("issues an access and refresh token once", async () => {
    const store = state.store as ReturnType<typeof createFakeStore>;
    await seedClient(store);
    const { code, verifier } = await issueCode(store);
    const now = new Date("2026-11-06T00:01:00Z");

    const first = await exchangeAuthorizationCode(store, {
      clientId: "vcl_test",
      code,
      redirectUri: REDIRECT,
      codeVerifier: verifier,
      pepper: PEPPER,
      now,
    });
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.body.token_type).toBe("Bearer");
      expect(first.body.scope).toBe("vantage.read");
      expect(first.body.access_token).toMatch(/^vat_/);
      expect(first.body.refresh_token).toMatch(/^vrt_/);
    }

    const replay = await exchangeAuthorizationCode(store, {
      clientId: "vcl_test",
      code,
      redirectUri: REDIRECT,
      codeVerifier: verifier,
      pepper: PEPPER,
      now,
    });
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.body.error).toBe("invalid_grant");
  });

  it("rejects a wrong verifier, client or redirect URI", async () => {
    const store = state.store as ReturnType<typeof createFakeStore>;
    await seedClient(store);
    const now = new Date("2026-11-06T00:01:00Z");

    for (const override of [
      { codeVerifier: "b".repeat(43) },
      { clientId: "vcl_other" },
      { redirectUri: "https://client.example.com/other" },
    ]) {
      const { code, verifier } = await issueCode(store);
      const outcome = await exchangeAuthorizationCode(store, {
        clientId: "vcl_test",
        code,
        redirectUri: REDIRECT,
        codeVerifier: verifier,
        pepper: PEPPER,
        now,
        ...override,
      });
      expect(outcome.ok).toBe(false);
    }
  });

  it("rejects an expired code", async () => {
    const store = state.store as ReturnType<typeof createFakeStore>;
    await seedClient(store);
    const { code, verifier } = await issueCode(store);
    const outcome = await exchangeAuthorizationCode(store, {
      clientId: "vcl_test",
      code,
      redirectUri: REDIRECT,
      codeVerifier: verifier,
      pepper: PEPPER,
      now: new Date("2026-11-06T01:00:00Z"),
    });
    expect(outcome.ok).toBe(false);
  });

  it("rotates refresh tokens and revokes the family when one is replayed", async () => {
    const store = state.store as ReturnType<typeof createFakeStore>;
    await seedClient(store);
    const { code, verifier } = await issueCode(store);
    const now = new Date("2026-11-06T00:01:00Z");
    const first = await exchangeAuthorizationCode(store, {
      clientId: "vcl_test",
      code,
      redirectUri: REDIRECT,
      codeVerifier: verifier,
      pepper: PEPPER,
      now,
    });
    if (!first.ok) throw new Error("expected tokens");

    const rotated = await refreshAccessToken(store, {
      clientId: "vcl_test",
      refreshToken: first.body.refresh_token,
      pepper: PEPPER,
      now,
    });
    expect(rotated.ok).toBe(true);
    if (rotated.ok) expect(rotated.body.refresh_token).not.toBe(first.body.refresh_token);

    const reuse = await refreshAccessToken(store, {
      clientId: "vcl_test",
      refreshToken: first.body.refresh_token,
      pepper: PEPPER,
      now,
    });
    expect(reuse.ok).toBe(false);

    // The replacement token dies too: a thief holding a copy must not outlive
    // the detection.
    const afterDetection = await refreshAccessToken(store, {
      clientId: "vcl_test",
      refreshToken: rotated.ok ? rotated.body.refresh_token : "",
      pepper: PEPPER,
      now,
    });
    expect(afterDetection.ok).toBe(false);
  });

  it("revokes idempotently", async () => {
    const store = state.store as ReturnType<typeof createFakeStore>;
    await seedClient(store);
    const { code, verifier } = await issueCode(store);
    const now = new Date("2026-11-06T00:01:00Z");
    const issued = await exchangeAuthorizationCode(store, {
      clientId: "vcl_test",
      code,
      redirectUri: REDIRECT,
      codeVerifier: verifier,
      pepper: PEPPER,
      now,
    });
    if (!issued.ok) throw new Error("expected tokens");

    await revokeToken(store, { token: issued.body.access_token, pepper: PEPPER, now });
    await revokeToken(store, { token: issued.body.access_token, pepper: PEPPER, now });
    const hash = await hashSecret(issued.body.access_token, PEPPER);
    expect(store.tokens.get(hash)?.revokedAt).not.toBeNull();
  });

  it("revokes only the replayed grant's family, not another device's", async () => {
    const store = state.store as ReturnType<typeof createFakeStore>;
    await seedClient(store);
    const now = new Date("2026-11-06T00:01:00Z");

    const grant = async () => {
      const { code, verifier } = await issueCode(store);
      const issued = await exchangeAuthorizationCode(store, {
        clientId: "vcl_test",
        code,
        redirectUri: REDIRECT,
        codeVerifier: verifier,
        pepper: PEPPER,
        now,
      });
      if (!issued.ok) throw new Error("expected tokens");
      return issued.body;
    };

    const laptop = await grant();
    const phone = await grant();

    // Replay the laptop's rotated token: its family dies.
    const rotated = await refreshAccessToken(store, {
      clientId: "vcl_test",
      refreshToken: laptop.refresh_token,
      pepper: PEPPER,
      now,
    });
    expect(rotated.ok).toBe(true);
    await refreshAccessToken(store, {
      clientId: "vcl_test",
      refreshToken: laptop.refresh_token,
      pepper: PEPPER,
      now,
    });

    // The phone's grant is untouched.
    const phoneRefresh = await refreshAccessToken(store, {
      clientId: "vcl_test",
      refreshToken: phone.refresh_token,
      pepper: PEPPER,
      now,
    });
    expect(phoneRefresh.ok).toBe(true);
  });

  it("revokes a pre-family token's replacement when the original is replayed", async () => {
    const store = state.store as ReturnType<typeof createFakeStore>;
    const now = new Date("2026-11-06T00:01:00Z");
    const legacy = "vrt_legacy";
    // A token issued before families existed: no family id.
    await store.createToken({
      tokenHash: await hashSecret(legacy, PEPPER),
      kind: "refresh",
      clientId: "vcl_test",
      userId: "user_1",
      workspaceId: "11111111-1111-4111-8111-111111111111",
      scopes: ["vantage.read"],
      expiresAt: new Date("2026-12-06T00:00:00Z"),
      familyId: null as unknown as string,
    });

    const rotated = await refreshAccessToken(store, {
      clientId: "vcl_test",
      refreshToken: legacy,
      pepper: PEPPER,
      now,
    });
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) return;

    const replay = await refreshAccessToken(store, {
      clientId: "vcl_test",
      refreshToken: legacy,
      pepper: PEPPER,
      now,
    });
    expect(replay.ok).toBe(false);

    const replacement = await refreshAccessToken(store, {
      clientId: "vcl_test",
      refreshToken: rotated.body.refresh_token,
      pepper: PEPPER,
      now,
    });
    expect(replacement.ok).toBe(false);
  });

  it("revokes a replacement that an earlier build gave a random family", async () => {
    const store = state.store as ReturnType<typeof createFakeStore>;
    const now = new Date("2026-11-06T00:01:00Z");
    const legacy = "vrt_legacy_old_build";
    await store.createToken({
      tokenHash: await hashSecret(legacy, PEPPER),
      kind: "refresh",
      clientId: "vcl_test",
      userId: "user_1",
      workspaceId: "11111111-1111-4111-8111-111111111111",
      scopes: ["vantage.read"],
      expiresAt: new Date("2026-12-06T00:00:00Z"),
      familyId: null as unknown as string,
    });
    // A replacement rotated by the previous build: random family, unlinked.
    const orphan = "vrt_orphan";
    await store.createToken({
      tokenHash: await hashSecret(orphan, PEPPER),
      kind: "refresh",
      clientId: "vcl_test",
      userId: "user_1",
      workspaceId: "11111111-1111-4111-8111-111111111111",
      scopes: ["vantage.read"],
      expiresAt: new Date("2026-12-06T00:00:00Z"),
      familyId: crypto.randomUUID(),
    });

    // Rotate the legacy token so a replay is possible, then replay it.
    const rotated = await refreshAccessToken(store, {
      clientId: "vcl_test",
      refreshToken: legacy,
      pepper: PEPPER,
      now,
    });
    expect(rotated.ok).toBe(true);

    const replay = await refreshAccessToken(store, {
      clientId: "vcl_test",
      refreshToken: legacy,
      pepper: PEPPER,
      now,
    });
    expect(replay.ok).toBe(false);

    const orphaned = await refreshAccessToken(store, {
      clientId: "vcl_test",
      refreshToken: orphan,
      pepper: PEPPER,
      now,
    });
    expect(orphaned.ok).toBe(false);
  });

  it("refreshes a clientless agent token, and refuses one that names a client", async () => {
    const store = state.store as ReturnType<typeof createFakeStore>;
    const now = new Date("2026-11-06T00:01:00Z");
    const raw = "vrt_agent_token";
    await store.createToken({
      tokenHash: await hashSecret(raw, PEPPER),
      kind: "refresh",
      clientId: null,
      userId: null,
      workspaceId: "11111111-1111-4111-8111-111111111111",
      registrationId: "reg_1",
      scopes: ["vantage.read", "vantage.draft"],
      expiresAt: new Date("2026-12-06T00:00:00Z"),
      familyId: crypto.randomUUID(),
    });

    const refreshed = await refreshAccessToken(store, {
      clientId: "",
      refreshToken: raw,
      pepper: PEPPER,
      now,
    });
    expect(refreshed.ok).toBe(true);
    if (refreshed.ok) expect(refreshed.body.scope).toBe("vantage.read vantage.draft");

    // A caller that names a client is trying to use a token it was not issued.
    const named = await refreshAccessToken(store, {
      clientId: "vcl_test",
      refreshToken: raw,
      pepper: PEPPER,
      now,
    });
    expect(named.ok).toBe(false);
  });
});

describe("MCP authentication", () => {
  it("accepts a store written before the subject revoke existed", () => {
    // Compile-time guard. If revokeTokensForSubject became required, this object
    // would fail typecheck, and so would every test double on the stacked
    // branches that predates it.
    const minimal: AgentStore = {
      getClient: async () => null,
      createClient: async () => {},
      createAuthorizationCode: async () => {},
      consumeAuthorizationCode: async () => null,
      createToken: async () => {},
      findToken: async () => null,
      revokeToken: async () => false,
      revokeTokenFamily: async () => 0,
      audit: async () => {},
    };
    expect(minimal.revokeTokensForSubject).toBeUndefined();
  });

  async function seedAccessToken(store: ReturnType<typeof createFakeStore>, expiresAt: Date) {
    const raw = "vat_test_token";
    await store.createToken({
      tokenHash: await hashSecret(raw, PEPPER),
      kind: "access",
      clientId: "vcl_test",
      userId: "user_1",
      workspaceId: "11111111-1111-4111-8111-111111111111",
      scopes: ["vantage.read"],
      expiresAt,
      familyId: crypto.randomUUID(),
    });
    return raw;
  }

  it("returns a 401 with the resource metadata pointer when the token is missing", async () => {
    const store = state.store as ReturnType<typeof createFakeStore>;
    const outcome = await authenticateMcpRequest(
      new Request(`${ORIGIN}/api/mcp`, { method: "POST" }),
      store,
      { pepper: PEPPER, origin: ORIGIN, now: new Date() },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.status).toBe(401);
      expect(outcome.challenge).toContain("/.well-known/oauth-protected-resource");
    }
  });

  it("accepts a live access token and rejects expired or revoked ones", async () => {
    const store = state.store as ReturnType<typeof createFakeStore>;
    const now = new Date("2026-11-06T00:00:00Z");
    const raw = await seedAccessToken(store, new Date("2026-11-06T01:00:00Z"));
    const request = () =>
      new Request(`${ORIGIN}/api/mcp`, {
        method: "POST",
        headers: { authorization: `Bearer ${raw}` },
      });

    const live = await authenticateMcpRequest(request(), store, { pepper: PEPPER, origin: ORIGIN, now });
    expect(live.ok).toBe(true);

    const expired = await authenticateMcpRequest(request(), store, {
      pepper: PEPPER,
      origin: ORIGIN,
      now: new Date("2026-11-06T02:00:00Z"),
    });
    expect(expired.ok).toBe(false);

    await revokeToken(store, { token: raw, pepper: PEPPER, now });
    const revoked = await authenticateMcpRequest(request(), store, { pepper: PEPPER, origin: ORIGIN, now });
    expect(revoked.ok).toBe(false);
  });

  it("fails closed without a pepper", async () => {
    const store = state.store as ReturnType<typeof createFakeStore>;
    const outcome = await authenticateMcpRequest(
      new Request(`${ORIGIN}/api/mcp`, { headers: { authorization: "Bearer x" } }),
      store,
      { pepper: "", origin: ORIGIN, now: new Date() },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.status).toBe(503);
  });

  it("rejects a pre-claim token once the workspace is claimed", async () => {
    const store = state.store as ReturnType<typeof createFakeStore>;
    const now = new Date("2026-11-06T00:00:00Z");
    const raw = "vat_pre_claim";
    await store.createToken({
      tokenHash: await hashSecret(raw, PEPPER),
      kind: "access",
      clientId: null,
      userId: null,
      workspaceId: "11111111-1111-4111-8111-111111111111",
      registrationId: "reg_1",
      scopes: ["vantage.read"],
      expiresAt: new Date("2026-11-06T01:00:00Z"),
      familyId: crypto.randomUUID(),
    });
    const request = () =>
      new Request(`${ORIGIN}/api/mcp`, {
        method: "POST",
        headers: { authorization: `Bearer ${raw}` },
      });

    const active = await authenticateMcpRequest(request(), store, {
      pepper: PEPPER,
      origin: ORIGIN,
      now,
      registrationStatus: async () => "active",
    });
    expect(active.ok).toBe(true);

    // The claim landed after this token was issued: it must stop working even
    // though its row was never revoked.
    const claimed = await authenticateMcpRequest(request(), store, {
      pepper: PEPPER,
      origin: ORIGIN,
      now,
      registrationStatus: async () => "claimed",
    });
    expect(claimed.ok).toBe(false);

    for (const status of ["expired", "revoked", null]) {
      const outcome = await authenticateMcpRequest(request(), store, {
        pepper: PEPPER,
        origin: ORIGIN,
        now,
        registrationStatus: async () => status,
      });
      expect(outcome.ok).toBe(false);
    }
  });

  it("keeps a post-claim token working after the claim", async () => {
    const store = state.store as ReturnType<typeof createFakeStore>;
    const now = new Date("2026-11-06T00:00:00Z");
    const raw = "vat_post_claim";
    await store.createToken({
      tokenHash: await hashSecret(raw, PEPPER),
      kind: "access",
      clientId: null,
      userId: null,
      workspaceId: "11111111-1111-4111-8111-111111111111",
      registrationId: "reg_1",
      scopes: ["vantage.read", "vantage.draft"],
      expiresAt: new Date("2026-11-06T01:00:00Z"),
      familyId: crypto.randomUUID(),
    });
    const outcome = await authenticateMcpRequest(
      new Request(`${ORIGIN}/api/mcp`, {
        method: "POST",
        headers: { authorization: `Bearer ${raw}` },
      }),
      store,
      { pepper: PEPPER, origin: ORIGIN, now, registrationStatus: async () => "claimed" },
    );
    expect(outcome.ok).toBe(true);
  });
});

describe("MCP protocol", () => {
  const ctx = { workspaceId: null, userId: "user_1", scopes: ["vantage.read"] };

  it("negotiates a supported protocol version and falls back to the latest", async () => {
    const known = await handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
      ctx,
      agentTools(),
    );
    expect((known.body as { result: { protocolVersion: string } }).result.protocolVersion).toBe(
      "2025-06-18",
    );

    const unknown = await handleMcpMessage(
      { jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } },
      ctx,
      agentTools(),
    );
    expect((unknown.body as { result: { protocolVersion: string } }).result.protocolVersion).toBe(
      "2025-11-25",
    );
  });

  it("acknowledges notifications with 202 and no body", async () => {
    const outcome = await handleMcpMessage(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      ctx,
      agentTools(),
    );
    expect(outcome.status).toBe(202);
    expect(outcome.body).toBeUndefined();
  });

  it("lists only tools the credential's scopes allow", async () => {
    const draftTool: McpTool = {
      name: "draft_reply",
      title: "Draft",
      description: "Draft",
      inputSchema: { type: "object" },
      requiredScope: "vantage.draft",
      run: async () => ({}),
    };
    const readOnly = await handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      ctx,
      [...agentTools(), draftTool],
    );
    const names = (readOnly.body as { result: { tools: { name: string }[] } }).result.tools.map(
      (tool) => tool.name,
    );
    expect(names).toContain("get_workspace_context");
    expect(names).not.toContain("draft_reply");

    const withDraft = await handleMcpMessage(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { ...ctx, scopes: ["vantage.read", "vantage.draft"] },
      [...agentTools(), draftTool],
    );
    expect(
      (withDraft.body as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name),
    ).toContain("draft_reply");
  });

  it("refuses an unknown tool and a missing scope", async () => {
    const unknown = await handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "nope" } },
      ctx,
      agentTools(),
    );
    expect((unknown.body as { error: { code: number } }).error.code).toBe(-32602);

    const draftTool: McpTool = {
      name: "draft_reply",
      title: "Draft",
      description: "Draft",
      inputSchema: { type: "object" },
      requiredScope: "vantage.draft",
      run: async () => ({}),
    };
    const denied = await handleMcpMessage(
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "draft_reply" } },
      ctx,
      [draftTool],
    );
    expect((denied.body as { error: { message: string } }).error.message).toContain("vantage.draft");
  });

  it("reports a tool failure in-band instead of failing the request", async () => {
    const broken: McpTool = {
      name: "broken",
      title: "Broken",
      description: "Broken",
      inputSchema: { type: "object" },
      requiredScope: "vantage.read",
      run: async () => {
        throw new Error("boom");
      },
    };
    const outcome = await handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "broken" } },
      ctx,
      [broken],
    );
    expect(outcome.status).toBe(200);
    expect((outcome.body as { result: { isError: boolean } }).result.isError).toBe(true);
  });

  it("rejects a malformed message", async () => {
    const outcome = await handleMcpMessage({ id: 1 }, ctx, agentTools());
    expect((outcome.body as { error: { code: number } }).error.code).toBe(-32600);
  });
});

describe("workspace context tool", () => {
  it("never accepts a workspace id from the caller", () => {
    const tool = agentTools().find((candidate) => candidate.name === "get_workspace_context")!;
    expect(tool.inputSchema).toEqual({ type: "object", properties: {}, additionalProperties: false });
    expect(tool.requiredScope).toBe(AGENT_READ_SCOPE);
  });

  it("returns an honest empty answer when the credential has no workspace", async () => {
    const tool = agentTools().find((candidate) => candidate.name === "get_workspace_context")!;
    const value = (await tool.run({}, { workspaceId: null, userId: null, scopes: ["vantage.read"] })) as {
      workspace: null;
      message: string;
    };
    expect(value.workspace).toBeNull();
    expect(value.message).toContain("claim");
  });
});

describe("discovery documents", () => {
  it("advertises the resource, scopes and endpoints", () => {
    const prm = protectedResourceMetadata(ORIGIN);
    expect(prm.resource).toBe(`${ORIGIN}/`);
    // Must equal the authorization server's issuer exactly.
    expect(prm.authorization_servers).toEqual([ORIGIN]);
    expect(authorizationServerMetadata(ORIGIN).issuer).toBe(prm.authorization_servers[0]);
    expect(prm.scopes_supported).toEqual(["vantage.read", "vantage.draft"]);

    const as = authorizationServerMetadata(ORIGIN);
    expect(as.authorization_endpoint).toBe(`${ORIGIN}/auth-agents`);
    expect(as.token_endpoint).toBe(`${ORIGIN}/oauth/token`);
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);
    expect(as.token_endpoint_auth_methods_supported).toEqual(["none"]);
  });

  it("describes the service, scopes and the no-posting rule", () => {
    const doc = authMarkdown(ORIGIN);
    expect(doc).toContain(`${ORIGIN}/api/mcp`);
    expect(doc).toContain("vantage.read");
    expect(doc).toContain("never posts");
    expect(doc).toContain("Free tier");
  });
});
