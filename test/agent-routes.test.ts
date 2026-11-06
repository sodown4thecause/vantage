import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ store: null as unknown, registrationStore: null as unknown }));

vi.mock("@/lib/agent/oauth/store", () => ({
  drizzleAgentStore: () => state.store,
}));
vi.mock("@/lib/agent/registration", async (original) => {
  const actual = await original<typeof import("@/lib/agent/registration")>();
  return { ...actual, drizzleRegistrationStore: () => state.registrationStore };
});

import { GET as authMarkdownRoute } from "@/app/auth.md/route";
import { POST as identityRoute } from "@/app/agent/identity/route";
import { POST as claimRoute } from "@/app/agent/identity/claim/route";
import { GET as authorizationServerRoute } from "@/app/api/agent/well-known/oauth-authorization-server/route";
import { GET as protectedResourceRoute } from "@/app/api/agent/well-known/oauth-protected-resource/route";
import { GET as mcpGet, POST as mcpPost } from "@/app/api/mcp/route";
import { POST as registerRoute } from "@/app/oauth/register/route";
import { POST as revokeRoute } from "@/app/oauth/revoke/route";
import { POST as tokenRoute } from "@/app/oauth/token/route";
import { base64Url, hashSecret } from "@/lib/agent/crypto";
import { signAssertion } from "@/lib/agent/assertion";
import type { AgentStore, AuditEntry, OAuthClientRecord } from "@/lib/agent/oauth/store";
import type { RegistrationRecord, RegistrationStore } from "@/lib/agent/registration";

const ORIGIN = "https://staging.example.com";
const PEPPER = "route-test-pepper";
const ASSERTION_KEY = "route-test-assertion-key";
const REDIRECT = "https://client.example.com/callback";

function createFakeStore() {
  const clients = new Map<string, OAuthClientRecord>();
  const codes = new Map<string, Record<string, unknown>>();
  const tokens = new Map<string, Record<string, unknown>>();
  const audits: AuditEntry[] = [];
  let sequence = 0;

  const store: AgentStore & { clients: typeof clients; tokens: typeof tokens; audits: typeof audits } = {
    clients,
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
      const row = codes.get(codeHash) as
        | { clientId: string; userId: string; workspaceId: string | null; scopes: string[]; redirectUri: string; codeChallenge: string; expiresAt: Date; consumedAt: Date | null }
        | undefined;
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
      tokens.set(input.tokenHash, { ...input, id: `tok_${sequence}`, revokedAt: null });
    },
    async findToken(tokenHash) {
      return (tokens.get(tokenHash) as never) ?? null;
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

function createFakeRegistrationStore() {
  const registrations = new Map<string, RegistrationRecord & { claimTokenHash: string; createdAt: Date }>();
  const attempts: Array<{ id: string; registrationId: string; userCodeHash: string; email: string | null; expiresAt: Date }> = [];
  const workspaces: string[] = [];
  let sequence = 0;
  const store: RegistrationStore & { registrations: typeof registrations; attempts: typeof attempts } = {
    registrations,
    attempts,
    async reserveRegistrationSlot() {
      return { ok: true };
    },
    async createTrialRegistration(input) {
      sequence += 1;
      const id = `reg_${sequence}`;
      const workspaceId = `ws_${sequence}`;
      workspaces.push(workspaceId);
      registrations.set(id, {
        id,
        status: "active",
        workspaceId,
        expiresAt: input.expiresAt,
        claimTokenExpiresAt: input.claimTokenExpiresAt,
        claimTokenHash: input.claimTokenHash,
        createdAt: new Date(),
      });
      return { id, workspaceId };
    },
    async findRegistration(id) {
      return registrations.get(id) ?? null;
    },
    async findRegistrationByClaimTokenHash(hash) {
      return [...registrations.values()].find((row) => row.claimTokenHash === hash) ?? null;
    },
    async createClaimAttempt(input) {
      sequence += 1;
      const id = `cla_${sequence}`;
      attempts.push({ id, ...input });
      return { id };
    },
    async expireRegistrations() {
      return { expired: 0, workspacesDeleted: 0 };
    },
    async consumeToolCall() {
      return true;
    },
    async consumeDraftAttempt() {
      return true;
    },
  };
  return store;
}

const form = (fields: Record<string, string>) => {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return new Request(`${ORIGIN}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
};

const jsonPost = (path: string, body: unknown) =>
  new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const mcpRequest = (body: unknown, token?: string) =>
  new Request(`${ORIGIN}/api/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

const saved = { ...process.env };

beforeEach(() => {
  state.store = createFakeStore();
  state.registrationStore = createFakeRegistrationStore();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  delete process.env.AGENT_REGISTRATION_ENABLED;
  delete process.env.AGENT_REGISTRATION_ORIGIN;
  delete process.env.AGENT_TOKEN_PEPPER;
  delete process.env.AGENT_ASSERTION_SIGNING_KEY;
  delete process.env.VANTAGE_DEPLOY_ENV;
});

afterEach(() => {
  process.env = { ...saved };
  vi.restoreAllMocks();
});

function enable() {
  process.env.AGENT_REGISTRATION_ENABLED = "true";
  process.env.AGENT_REGISTRATION_ORIGIN = ORIGIN;
  process.env.AGENT_TOKEN_PEPPER = PEPPER;
  process.env.AGENT_ASSERTION_SIGNING_KEY = ASSERTION_KEY;
}

describe("flag off", () => {
  it("hides every agent endpoint", async () => {
    const responses = await Promise.all([
      protectedResourceRoute(),
      authorizationServerRoute(),
      authMarkdownRoute(),
      registerRoute(jsonPost("/oauth/register", { redirect_uris: [REDIRECT] })),
      tokenRoute(form({ grant_type: "authorization_code", client_id: "x" })),
      revokeRoute(form({ token: "x" })),
      mcpPost(mcpRequest({ jsonrpc: "2.0", id: 1, method: "initialize" })),
      mcpGet(),
      identityRoute(jsonPost("/agent/identity", { type: "anonymous" })),
      claimRoute(jsonPost("/agent/identity/claim", { claim_token: "clm_x" })),
    ]);
    for (const response of responses) expect(response.status).toBe(404);
  });

  it("stays off in production even with the flag set", async () => {
    enable();
    process.env.VANTAGE_DEPLOY_ENV = "production";
    expect((await protectedResourceRoute()).status).toBe(404);
    expect((await mcpPost(mcpRequest({ jsonrpc: "2.0", id: 1, method: "initialize" }))).status).toBe(404);
  });
});

describe("discovery routes", () => {
  it("serves the protected resource and authorization server metadata", async () => {
    enable();
    const prm = await protectedResourceRoute();
    expect(prm.status).toBe(200);
    expect((await prm.json()).resource).toBe(`${ORIGIN}/`);

    const as = await authorizationServerRoute();
    expect(as.status).toBe(200);
    expect((await as.json()).authorization_endpoint).toBe(`${ORIGIN}/auth-agents`);
  });

  it("serves auth.md as markdown", async () => {
    enable();
    const response = await authMarkdownRoute();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(await response.text()).toContain("never posts");
  });
});

describe("client registration", () => {
  it("registers a public client and audits it", async () => {
    enable();
    const response = await registerRoute(
      jsonPost("/oauth/register", {
        client_name: "Claude Code",
        redirect_uris: [REDIRECT],
        scope: "vantage.read",
      }),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.client_id).toMatch(/^vcl_/);
    expect(body.token_endpoint_auth_method).toBe("none");
    expect(body.scope).toBe("vantage.read");

    const store = state.store as ReturnType<typeof createFakeStore>;
    expect(store.clients.get(body.client_id)?.redirectUris).toEqual([REDIRECT]);
    expect(store.audits.map((entry) => entry.event)).toContain("client_registered");
  });

  it("refuses an insecure redirect URI", async () => {
    enable();
    const response = await registerRoute(
      jsonPost("/oauth/register", { redirect_uris: ["http://evil.example.com/cb"] }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("invalid_redirect_uri");
  });
});

describe("token route", () => {
  async function registerAndAuthorize() {
    const store = state.store as ReturnType<typeof createFakeStore>;
    await store.createClient({
      id: "vcl_test",
      name: "Claude Code",
      redirectUris: [REDIRECT],
      scopes: ["vantage.read"],
    });
    const verifier = "a".repeat(43);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const challenge = base64Url(new Uint8Array(digest));
    const code = "vac_test_code";
    await store.createAuthorizationCode({
      codeHash: await hashSecret(code, PEPPER),
      clientId: "vcl_test",
      userId: "user_1",
      workspaceId: null,
      scopes: ["vantage.read"],
      redirectUri: REDIRECT,
      codeChallenge: challenge,
      expiresAt: new Date(Date.now() + 60_000),
    });
    return { code, verifier };
  }

  it("exchanges a code for tokens", async () => {
    enable();
    const { code, verifier } = await registerAndAuthorize();
    const response = await tokenRoute(
      form({
        grant_type: "authorization_code",
        client_id: "vcl_test",
        code,
        redirect_uri: REDIRECT,
        code_verifier: verifier,
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.access_token).toMatch(/^vat_/);
    expect(body.scope).toBe("vantage.read");
  });

  it("rejects an unsupported grant and a missing client", async () => {
    enable();
    const unsupported = await tokenRoute(form({ grant_type: "password", client_id: "vcl_test" }));
    expect(unsupported.status).toBe(400);
    expect((await unsupported.json()).error).toBe("unsupported_grant_type");

    const noClient = await tokenRoute(form({ grant_type: "authorization_code" }));
    expect(noClient.status).toBe(400);
    expect((await noClient.json()).error).toBe("invalid_client");
  });

  it("revokes without revealing whether the token existed", async () => {
    enable();
    const response = await revokeRoute(form({ token: "vat_unknown" }));
    expect(response.status).toBe(200);
    // An unknown token must not grow the audit table.
    const store = state.store as ReturnType<typeof createFakeStore>;
    expect(store.audits.map((entry) => entry.event)).not.toContain("token_revoked");
  });
});

describe("MCP route", () => {
  it("challenges an unauthenticated request with the resource metadata pointer", async () => {
    enable();
    const response = await mcpPost(mcpRequest({ jsonrpc: "2.0", id: 1, method: "initialize" }));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      `${ORIGIN}/.well-known/oauth-protected-resource`,
    );
  });

  it("serves initialize and tools/list for a live token", async () => {
    enable();
    const store = state.store as ReturnType<typeof createFakeStore>;
    const raw = "vat_live_token";
    await store.createToken({
      tokenHash: await hashSecret(raw, PEPPER),
      kind: "access",
      clientId: "vcl_test",
      userId: "user_1",
      workspaceId: null,
      scopes: ["vantage.read"],
      expiresAt: new Date(Date.now() + 60_000),
      familyId: crypto.randomUUID(),
    });

    const init = await mcpPost(
      mcpRequest({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" } }, raw),
    );
    expect(init.status).toBe(200);
    expect((await init.json()).result.serverInfo.name).toBe("vantage");

    const list = await mcpPost(mcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" }, raw));
    const names = (await list.json()).result.tools.map((tool: { name: string }) => tool.name);
    // A read-only credential never sees the draft tool.
    expect(names).toEqual([
      "get_workspace_context",
      "list_todays_conversations",
      "get_conversation",
    ]);
  });

  it("shows the draft tool only to a credential that holds the draft scope", async () => {
    enable();
    const store = state.store as ReturnType<typeof createFakeStore>;
    const raw = "vat_draft_token";
    await store.createToken({
      tokenHash: await hashSecret(raw, PEPPER),
      kind: "access",
      clientId: "vcl_test",
      userId: "user_1",
      workspaceId: null,
      scopes: ["vantage.read", "vantage.draft"],
      expiresAt: new Date(Date.now() + 60_000),
      familyId: crypto.randomUUID(),
    });
    const list = await mcpPost(mcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }, raw));
    const names = (await list.json()).result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain("draft_reply");
  });

  it("rejects an unsupported protocol version header", async () => {
    enable();
    const store = state.store as ReturnType<typeof createFakeStore>;
    const raw = "vat_live_token";
    await store.createToken({
      tokenHash: await hashSecret(raw, PEPPER),
      kind: "access",
      clientId: "vcl_test",
      userId: "user_1",
      workspaceId: null,
      scopes: ["vantage.read"],
      expiresAt: new Date(Date.now() + 60_000),
      familyId: crypto.randomUUID(),
    });
    const request = new Request(`${ORIGIN}/api/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${raw}`,
        "mcp-protocol-version": "1999-01-01",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect((await mcpPost(request)).status).toBe(400);
  });

  it("does not offer a server-sent event stream", async () => {
    enable();
    expect((await mcpGet()).status).toBe(405);
  });
});

describe("anonymous registration route", () => {
  it("registers an anonymous agent and returns a claim token", async () => {
    enable();
    const response = await identityRoute(jsonPost("/agent/identity", { type: "anonymous" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.registration_type).toBe("anonymous");
    expect(body.identity_assertion.split(".")).toHaveLength(3);
    expect(body.pre_claim_scopes).toEqual(["vantage.read"]);
    expect(body.post_claim_scopes).toEqual(["vantage.read", "vantage.draft"]);
    expect(body.claim_token).toMatch(/^clm_/);
    expect(body.claim_url).toBe(`${ORIGIN}/agent/identity/claim`);

    const store = state.store as ReturnType<typeof createFakeStore>;
    expect(store.audits.map((entry) => entry.event)).toContain("agent_registered");
  });

  it("refuses the identity types this service does not accept", async () => {
    enable();
    const serviceAuth = await identityRoute(jsonPost("/agent/identity", { type: "service_auth" }));
    expect(serviceAuth.status).toBe(400);
    expect((await serviceAuth.json()).error).toBe("service_auth_not_enabled");

    const assertion = await identityRoute(jsonPost("/agent/identity", { type: "identity_assertion" }));
    expect(assertion.status).toBe(400);
    expect((await assertion.json()).error).toBe("issuer_not_enabled");

    const missing = await identityRoute(jsonPost("/agent/identity", {}));
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toBe("invalid_request");
  });

  it("audits a registration-cap denial", async () => {
    enable();
    const registrations = state.registrationStore as ReturnType<typeof createFakeRegistrationStore>;
    registrations.reserveRegistrationSlot = async () => ({ ok: false, reason: "rate_limited" });

    const response = await identityRoute(jsonPost("/agent/identity", { type: "anonymous" }));
    expect(response.status).toBe(429);

    const store = state.store as ReturnType<typeof createFakeStore>;
    const denial = store.audits.find((entry) => entry.event === "registration_denied");
    expect(denial?.detail).toEqual({ reason: "rate_limited" });
  });
});

describe("claim route", () => {
  it("starts a ceremony for a real claim token", async () => {
    enable();
    const registered = await identityRoute(jsonPost("/agent/identity", { type: "anonymous" }));
    const { claim_token: claimToken } = await registered.json();

    const response = await claimRoute(
      jsonPost("/agent/identity/claim", { claim_token: claimToken, email: "human@example.com" }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("initiated");
    expect(body.claim_attempt.user_code).toMatch(/^\d{6}$/);
    expect(body.claim_attempt.verification_uri).toContain("/auth-agents/claim?attempt=");
    expect(body.claim_attempt.interval).toBe(5);
  });

  it("rejects a missing token and a malformed email", async () => {
    enable();
    const missing = await claimRoute(jsonPost("/agent/identity/claim", {}));
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toBe("invalid_request");

    const badEmail = await claimRoute(
      jsonPost("/agent/identity/claim", { claim_token: "clm_x", email: "not-an-email" }),
    );
    expect(badEmail.status).toBe(400);
  });
});

describe("jwt-bearer token grant", () => {
  it("exchanges an anonymous assertion for a read-only token", async () => {
    enable();
    const registered = await identityRoute(jsonPost("/agent/identity", { type: "anonymous" }));
    const { identity_assertion: assertion } = await registered.json();

    const response = await tokenRoute(
      form({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.scope).toBe("vantage.read");
    expect(body.access_token).toMatch(/^vat_/);
  });

  it("refuses a forged assertion", async () => {
    enable();
    const response = await tokenRoute(
      form({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: "not.a.token",
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("invalid_grant");
  });

  it("refuses an assertion signed with another key", async () => {
    enable();
    const forged = await signAssertion(
      {
        iss: ORIGIN,
        sub: "reg_1",
        aud: `${ORIGIN}/`,
        iat: Math.floor(Date.now() / 1_000),
        exp: Math.floor(Date.now() / 1_000) + 900,
        jti: "jti_1",
        scope: "vantage.read",
        typ: "agent_identity",
      },
      "some-other-key",
    );
    const response = await tokenRoute(
      form({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: forged }),
    );
    expect(response.status).toBe(400);
  });
});

describe("trial quota at the MCP boundary", () => {
  it("refuses a tool call once the trial quota is spent", async () => {
    enable();
    const store = state.store as ReturnType<typeof createFakeStore>;
    const registrations = state.registrationStore as ReturnType<typeof createFakeRegistrationStore>;
    const raw = "vat_trial_token";
    await store.createToken({
      tokenHash: await hashSecret(raw, PEPPER),
      kind: "access",
      clientId: null,
      userId: null,
      workspaceId: "ws_1",
      registrationId: "reg_1",
      scopes: ["vantage.read"],
      expiresAt: new Date(Date.now() + 60_000),
      familyId: crypto.randomUUID(),
    });
    registrations.consumeToolCall = async () => false;

    const response = await mcpPost(mcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }, raw));
    expect(response.status).toBe(429);
    expect((await response.json()).error.message).toContain("quota");
    // The denial is recorded, so an operator can see why the trial was blocked.
    expect(store.audits.map((entry) => entry.event)).toContain("quota_denied");
  });
});
