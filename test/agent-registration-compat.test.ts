import { createServer } from "node:net";
import { auth, Client, StreamableHTTPClientTransport, type OAuthClientProvider, type OAuthDiscoveryState, type StoredOAuthTokens } from "@modelcontextprotocol/client";
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unstable_dev, type Unstable_DevWorker } from "wrangler";
import fixtureWorker, { type CompatibilityConfig } from "@/scripts/spikes/agent-registration/worker";

// Synthetic identity and keys live only in this test process; no real Neon service is called.
let worker: Unstable_DevWorker;
let config: CompatibilityConfig;
let humanKeys: Awaited<ReturnType<typeof generateKeyPair>>;
let anonymousKeys: Awaited<ReturnType<typeof generateKeyPair>>;
const clientId = "ar00-public-client";
const subject = "ar00-synthetic-human";
const resource = () => `${config.origin}/mcp`;

async function token(claims: JWTPayload = {}, anonymous = false) {
  return new SignJWT({
    sub: anonymous ? "ar00-synthetic-registration" : subject,
    client_id: anonymous ? "ar00-anonymous-client" : clientId,
    scope: anonymous ? "workspace:read" : "openid email", ...claims,
  }).setProtectedHeader({ alg: "EdDSA", kid: anonymous ? "anonymous-fixture" : "neon-fixture" })
    .setIssuer(typeof claims.iss === "string" ? claims.iss : anonymous ? config.anonymousIssuer : config.neonIssuer)
    .setAudience(claims.aud ?? resource()).setIssuedAt().setExpirationTime(claims.exp ?? "15m")
    .sign((anonymous ? anonymousKeys : humanKeys).privateKey);
}

async function rpc(bearer: string | undefined, method = "tools/list", params?: unknown, protocol = "2025-11-25") {
  return fetch(resource(), {
    method: "POST", signal: AbortSignal.timeout(10_000),
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream",
      "mcp-protocol-version": protocol, ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: {
      ...(params && typeof params === "object" ? params : {}),
    } }),
  });
}

async function rpcBody(response: Response) {
  const text = await response.text();
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const data = text.split("\n").find(line => line.startsWith("data: "));
    if (!data) throw new Error("Missing fixture SSE result");
    return JSON.parse(data.slice(6));
  }
  return JSON.parse(text);
}

beforeAll(async () => {
  const port = await new Promise<number>((resolve, reject) => {
    const server = createServer(); server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("No fixture port"));
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
  humanKeys = await generateKeyPair("EdDSA"); anonymousKeys = await generateKeyPair("EdDSA");
  const origin = `http://127.0.0.1:${port}`;
  const neonIssuer = "http://127.0.0.1:9473/staging-branch/auth";
  config = {
    origin, neonIssuer, anonymousIssuer: origin, enabled: true, deployment: "staging",
    neonJwks: { keys: [{ ...await exportJWK(humanKeys.publicKey), kid: "neon-fixture" }] },
    anonymousJwks: { keys: [{ ...await exportJWK(anonymousKeys.publicKey), kid: "anonymous-fixture" }] },
    grants: [
      { issuer: neonIssuer, subject, clientId, workspaceId: "fixture-workspace-a", active: true },
      { issuer: neonIssuer, subject: "revoked-human", clientId, workspaceId: "fixture-workspace-a", active: false },
      { issuer: origin, subject: "ar00-synthetic-registration", clientId: "ar00-anonymous-client", workspaceId: "fixture-workspace-b", active: true },
    ],
  };
  worker = await unstable_dev("scripts/spikes/agent-registration/worker.ts", {
    config: "scripts/spikes/agent-registration/wrangler.jsonc", local: true,
    ip: "127.0.0.1", port, inspectorPort: 0, persist: false, logLevel: "error",
    vars: { AR00_FIXTURE_CONFIG: JSON.stringify(config) },
    experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false },
  });
}, 60_000);

afterAll(async () => { if (worker) await worker.stop(); }, 15_000);

describe("AR00: real workerd + pinned MCP server + real test signatures", () => {
  it("publishes both issuers without pretending Neon supports anonymous grants", async () => {
    const metadata = await fetch(`${config.origin}/.well-known/oauth-protected-resource`).then(r => r.json());
    expect(metadata.authorization_servers).toEqual([config.neonIssuer, config.anonymousIssuer]);
    expect(metadata.resource).toBe(resource());
    const own = await fetch(`${config.origin}/.well-known/oauth-authorization-server`).then(r => r.json());
    expect(own.issuer).toBe(config.anonymousIssuer);
    expect(own.agent_auth.identity_types_supported).toEqual(["anonymous"]);
    expect(own.grant_types_supported).not.toContain("authorization_code");
  });

  it("challenges unauthenticated callers with the protected resource metadata", async () => {
    const response = await rpc(undefined);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain('/.well-known/oauth-protected-resource"');
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("serves a pinned 2025 stateless tools request", async () => {
    const response = await rpc(await token());
    expect(response.status).toBe(200);
    expect((await rpcBody(response)).result.tools[0].name).toBe("fixture_context");
    expect(response.headers.get("mcp-session-id")).toBeNull();
  });

  it("serves a legacy initialize request without a persistent session", async () => {
    const response = await rpc(await token(), "initialize", {
      protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "ar00-legacy", version: "0.0.0" },
    }, "2025-11-25");
    expect(response.status).toBe(200);
    const data = (await response.text()).split("\n").find(line => line.startsWith("data: "));
    expect(JSON.parse(data!.slice(6)).result.protocolVersion).toBe("2025-11-25");
    expect(response.headers.get("mcp-session-id")).toBeNull();
  });

  it.each([
    ["other branch sharing the same signing key", () => ({ iss: config.neonIssuer.replace("staging-branch", "production-branch") })],
    ["other audience", () => ({ aud: "https://elsewhere.invalid/mcp" })],
    ["expired token", () => ({ exp: Math.floor(Date.now() / 1000) - 60 })],
    ["missing subject", () => ({ sub: "" })],
    ["future not-before", () => ({ nbf: Math.floor(Date.now() / 1000) + 3600 })],
  ] as const)("denies %s", async (_description, claims) => {
    expect((await rpc(await token(claims()))).status).toBe(401);
  });

  it("accepts audience arrays only when they include this exact resource", async () => {
    expect((await rpc(await token({ aud: [resource(), `${config.neonIssuer}/oauth2/userinfo`] }))).status).toBe(200);
  });

  it("rejects a malformed or differently signed token", async () => {
    expect((await rpc("not-a-jwt")).status).toBe(401);
    const outsider = await generateKeyPair("EdDSA");
    const forged = await new SignJWT({ sub: subject, client_id: clientId }).setProtectedHeader({ alg: "EdDSA", kid: "neon-fixture" })
      .setIssuer(config.neonIssuer).setAudience(resource()).setExpirationTime("15m").sign(outsider.privateKey);
    expect((await rpc(forged)).status).toBe(401);
  });

  it("does not treat a valid Neon identity or fabricated scope as an app grant", async () => {
    expect((await rpc(await token({ sub: "ungranted-human", scope: "workspace:read admin" }))).status).toBe(403);
    expect((await rpc(await token({ sub: "revoked-human" }))).status).toBe(403);
    expect((await rpc(await token({ client_id: "other-client" }))).status).toBe(403);
  });

  it("passes each verified principal to a narrow workspace fixture", async () => {
    for (const [anonymous, own, other] of [[false, "a", "b"], [true, "b", "a"]] as const) {
      const bearer = await token({}, anonymous);
      const accepted = await rpc(bearer, "tools/call", { name: "fixture_context", arguments: { workspaceId: `fixture-workspace-${own}` } });
      const result = (await rpcBody(accepted)).result;
      expect(result.structuredContent).toMatchObject({ workspaceId: `fixture-workspace-${own}`, mocked: true });
      const denied = await rpc(bearer, "tools/call", { name: "fixture_context", arguments: { workspaceId: `fixture-workspace-${other}` } });
      expect((await rpcBody(denied)).result).toMatchObject({ isError: true, content: [{ text: "forbidden" }] });
    }
  });

  it("blocks untrusted browser origins before MCP dispatch", async () => {
    const response = await fetch(resource(), { method: "POST", headers: { origin: "https://attacker.invalid" } });
    expect(response.status).toBe(403);
  });

  it("is unavailable with no fixture config, flag off, or a production deployment", async () => {
    const req = () => new Request("https://contextfor.dev/mcp", { method: "POST" });
    expect((await fixtureWorker.fetch(req(), {})).status).toBe(404);
    for (const patch of [{ enabled: false }, { deployment: "production" }]) {
      expect((await fixtureWorker.fetch(req(), { AR00_FIXTURE_CONFIG: JSON.stringify({ ...config, ...patch }) })).status).toBe(404);
    }
  });
});

class FixtureClientProvider implements OAuthClientProvider {
  redirectUrl = "http://localhost:54321/callback";
  clientMetadata = { redirect_uris: [this.redirectUrl], grant_types: ["authorization_code"], response_types: ["code"], token_endpoint_auth_method: "none" };
  authorization?: URL;
  verifier = "";
  storedTokens?: StoredOAuthTokens;
  discovery?: OAuthDiscoveryState;
  state() { return "ar00-fixture-state"; }
  clientInformation() { return { client_id: clientId, issuer: config.neonIssuer }; }
  tokens() { return this.storedTokens; }
  saveTokens(value: StoredOAuthTokens) { this.storedTokens = value; }
  redirectToAuthorization(value: URL) { this.authorization = value; }
  saveCodeVerifier(value: string) { this.verifier = value; }
  codeVerifier() { return this.verifier; }
  saveDiscoveryState(value: OAuthDiscoveryState) { this.discovery = value; }
  discoveryState() { return this.discovery; }
}

/** A wire-contract double, NOT a real Neon server or an OAuth implementation for the app. */
function mockNeon() {
  const codes = new Map<string, URLSearchParams>();
  const calls: string[] = [];
  let requestedScope = "";
  const mockedFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url); calls.push(url.origin + url.pathname);
    if (url.origin === config.origin) return fetch(request);
    if (url.origin !== new URL(config.neonIssuer).origin) throw new Error("Unexpected fixture destination");
    if (url.pathname.includes(".well-known/")) return Response.json({
      issuer: config.neonIssuer, authorization_endpoint: `${config.neonIssuer}/oauth2/authorize`,
      token_endpoint: `${config.neonIssuer}/oauth2/token`,
      response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"], code_challenge_methods_supported: ["S256"],
      scopes_supported: ["openid", "email"], authorization_response_iss_parameter_supported: true,
    });
    if (url.pathname.endsWith("/oauth2/authorize")) {
      if (url.searchParams.get("code_challenge_method") !== "S256" || !url.searchParams.get("code_challenge")) return Response.json({ error: "invalid_request" }, { status: 400 });
      expect(url.searchParams.get("resource")).toBe(resource());
      requestedScope = url.searchParams.get("scope") ?? "";
      const code = crypto.randomUUID(); codes.set(code, url.searchParams);
      const redirect = new URL(url.searchParams.get("redirect_uri")!);
      redirect.searchParams.set("code", code); redirect.searchParams.set("state", url.searchParams.get("state")!);
      redirect.searchParams.set("iss", config.neonIssuer);
      return new Response(null, { status: 302, headers: { location: redirect.href } });
    }
    if (url.pathname.endsWith("/oauth2/token")) {
      const body = new URLSearchParams(await request.text());
      const grant = codes.get(body.get("code") ?? "");
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body.get("code_verifier") ?? ""));
      const challenge = Buffer.from(digest).toString("base64url");
      if (!grant || grant.get("code_challenge") !== challenge || body.get("client_id") !== clientId
        || body.get("redirect_uri") !== grant.get("redirect_uri") || body.get("resource") !== resource()) {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      codes.delete(body.get("code")!);
      return Response.json({ access_token: await token(), token_type: "Bearer", expires_in: 3600, scope: "openid email" });
    }
    throw new Error("Unexpected fixture endpoint");
  };
  return { mockedFetch, calls, get requestedScope() { return requestedScope; } };
}

it("official client discovers the human issuer, completes PKCE, then calls workerd", async () => {
  const provider = new FixtureClientProvider();
  const server = mockNeon();
  const options = { serverUrl: resource(), resourceMetadataUrl: new URL(`${config.origin}/.well-known/oauth-protected-resource`), fetchFn: server.mockedFetch };
  expect(await auth(provider, options)).toBe("REDIRECT");
  expect(provider.authorization?.href).toContain(`${config.neonIssuer}/oauth2/authorize`);
  const approval = await server.mockedFetch(provider.authorization!, { redirect: "manual" });
  const callback = new URL(approval.headers.get("location")!);
  expect(callback.searchParams.get("state")).toBe(await provider.state());
  const code = callback.searchParams.get("code")!;
  expect(await auth(provider, { ...options, authorizationCode: code, iss: callback.searchParams.get("iss")! })).toBe("AUTHORIZED");
  expect(server.requestedScope.split(" ").sort()).toEqual(["email", "openid"]);
  expect(provider.storedTokens?.issuer).toBe(config.neonIssuer);
  const client = new Client({ name: "ar00-sdk-client", version: "2.4.0" }, {
    supportedProtocolVersions: ["2025-11-25"],
  });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(resource()), {
      requestInit: { headers: { authorization: `Bearer ${provider.storedTokens!.access_token}` } },
    }));
    const result = await client.callTool({ name: "fixture_context", arguments: { workspaceId: "fixture-workspace-a" } });
    expect(result.structuredContent).toMatchObject({ mocked: true, workspaceId: "fixture-workspace-a" });
  } finally { await client.close(); }
  await expect(auth(provider, { ...options, authorizationCode: code, iss: config.neonIssuer })).rejects.toThrow();
  expect(server.calls.filter(url => url === `${config.origin}/.well-known/oauth-authorization-server`)).toHaveLength(0);
}, 20_000);

it("does not redeem a human authorization code under the anonymous issuer", async () => {
  const provider = new FixtureClientProvider(); const server = mockNeon();
  const options = { serverUrl: resource(), resourceMetadataUrl: new URL(`${config.origin}/.well-known/oauth-protected-resource`), fetchFn: server.mockedFetch };
  await auth(provider, options);
  const before = server.calls.filter(url => url.endsWith("/oauth2/token")).length;
  await expect(auth(provider, { ...options, authorizationCode: "must-not-be-sent", iss: config.anonymousIssuer })).rejects.toThrow();
  expect(server.calls.filter(url => url.endsWith("/oauth2/token"))).toHaveLength(before);
});
