/** AR00 ONLY: fixture verification in workerd. Not imported by the application. */
import { createMcpHandler, hostHeaderValidationResponse, McpServer, originValidationResponse } from "@modelcontextprotocol/server";
import { createLocalJWKSet, decodeJwt, jwtVerify, type JSONWebKeySet } from "jose";
import { z } from "zod";

export type CompatibilityConfig = {
  origin: string;
  neonIssuer: string;
  anonymousIssuer: string;
  neonJwks: JSONWebKeySet;
  anonymousJwks: JSONWebKeySet;
  enabled: boolean;
  deployment: string;
  grants: Array<{ issuer: string; subject: string; clientId: string; workspaceId: string; active: boolean }>;
};

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(data, {
  status, headers: { "cache-control": "no-store", ...headers },
});

const fixtureWorker = {
  async fetch(request: Request, env: { AR00_FIXTURE_CONFIG?: string }): Promise<Response> {
    // No usable defaults, real identity, network fetch, database or registration.
    if (!env.AR00_FIXTURE_CONFIG) return json({ error: "not_available" }, 404);
    const config = JSON.parse(env.AR00_FIXTURE_CONFIG) as CompatibilityConfig;
    if (!config.enabled || config.deployment !== "staging") return json({ error: "not_available" }, 404);
    const origin = new URL(config.origin);
    const rejected = hostHeaderValidationResponse(request, [origin.hostname])
      ?? originValidationResponse(request, [config.origin]);
    if (rejected) return rejected;
    const path = new URL(request.url).pathname;
    const resource = `${config.origin}/mcp`;
    const metadataUrl = `${config.origin}/.well-known/oauth-protected-resource`;
    if (path === "/.well-known/oauth-protected-resource") return json({
      resource, authorization_servers: [config.neonIssuer, config.anonymousIssuer],
      // Neon supports identity scopes, not Vantage action scopes. Grants remain server-owned.
      scopes_supported: ["openid", "email"], bearer_methods_supported: ["header"],
    });
    if (path === "/.well-known/oauth-authorization-server") return json({
      issuer: config.anonymousIssuer,
      token_endpoint: `${config.anonymousIssuer}/oauth2/token`,
      grant_types_supported: ["urn:ietf:params:oauth:grant-type:jwt-bearer", "urn:workos:agent-auth:grant-type:claim"],
      agent_auth: { identity_endpoint: `${config.anonymousIssuer}/agent/identity`, identity_types_supported: ["anonymous"] },
    });
    if (path !== "/mcp") return json({ error: "not_available" }, 404);
    const challenge = () => json({ error: "unauthorized" }, 401, {
      "www-authenticate": `Bearer resource_metadata="${metadataUrl}"`,
    });
    const match = /^Bearer ([^\s]+)$/i.exec(request.headers.get("authorization") ?? "");
    if (!match) return challenge();
    try {
      // Unverified iss only selects a pinned key set; it never supplies a URL or grants access.
      const unverified = decodeJwt(match[1]);
      const issuer = unverified.iss;
      if (issuer !== config.neonIssuer && issuer !== config.anonymousIssuer) return challenge();
      const keys = issuer === config.neonIssuer ? config.neonJwks : config.anonymousJwks;
      const { payload } = await jwtVerify(match[1], createLocalJWKSet(keys), {
        issuer, audience: resource, algorithms: ["EdDSA"], requiredClaims: ["sub", "exp", "client_id"],
      });
      if (!payload.sub || typeof payload.client_id !== "string" || !payload.client_id) return challenge();
      const grant = config.grants.find(g => g.active && g.issuer === issuer
        && g.subject === payload.sub && g.clientId === payload.client_id);
      if (!grant) return json({ error: "needs_grant" }, 403);
      const handler = createMcpHandler(() => {
        const server = new McpServer({ name: "vantage-ar00-fixture", version: "0.0.0" }, {
          supportedProtocolVersions: ["2025-11-25"],
        });
        server.registerTool("fixture_context", {
          description: "AR00 synthetic context. No Vantage data is read.",
          inputSchema: z.object({ workspaceId: z.string() }),
          annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
        }, async ({ workspaceId }) => {
          if (workspaceId !== grant.workspaceId) return { isError: true, content: [{ type: "text", text: "forbidden" }] };
          const context = { workspaceId, mocked: true, productUrl: "https://contextfor.dev", evidence: [] };
          return { content: [{ type: "text", text: JSON.stringify(context) }], structuredContent: context };
        });
        return server;
      });
      return await handler.fetch(request, { authInfo: {
        token: match[1], clientId: grant.clientId,
        scopes: typeof payload.scope === "string" ? payload.scope.split(" ") : [],
        expiresAt: payload.exp, resource: new URL(resource),
      } });
    } catch {
      return challenge();
    }
  },
};

export default fixtureWorker;
