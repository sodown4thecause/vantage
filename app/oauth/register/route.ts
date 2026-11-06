import { AGENT_SCOPES, agentRegistrationEnabled, parseScopes } from "@/lib/agent/config";
import { randomToken } from "@/lib/agent/crypto";
import { normalizeRedirectUris } from "@/lib/agent/oauth/redirect";
import { drizzleAgentStore } from "@/lib/agent/oauth/store";
import { agentIpHash, agentRateLimit } from "@/lib/agent/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

/**
 * RFC 7591 dynamic client registration. Public clients only: no secret is
 * issued, so every code exchange must present a PKCE verifier.
 */
export async function POST(req: Request) {
  if (!agentRegistrationEnabled()) return new Response("Not found", { status: 404 });

  const ipHash = await agentIpHash(req);
  if (!(await agentRateLimit("agent-register", ipHash ?? "unknown"))) {
    return Response.json(
      { error: "rate_limited", error_description: "Too many registrations. Try again shortly." },
      { status: 429, headers: { "retry-after": "60", "cache-control": "no-store" } },
    );
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return json({ error: "invalid_client_metadata", error_description: "A JSON body is required." }, 400);
  }
  const redirectUris = normalizeRedirectUris(body.redirect_uris);
  if (!redirectUris) {
    return json(
      {
        error: "invalid_redirect_uri",
        error_description:
          "redirect_uris must be 1-5 absolute https URLs (http is allowed on localhost only), without fragments.",
      },
      400,
    );
  }

  const name =
    typeof body.client_name === "string" && body.client_name.trim()
      ? body.client_name.trim().slice(0, 100)
      : "MCP client";
  const requested = parseScopes(typeof body.scope === "string" ? body.scope : null);
  const scopes = requested.length > 0 ? requested : [...AGENT_SCOPES];
  const clientId = randomToken("vcl", 16);

  const store = drizzleAgentStore();
  await store.createClient({ id: clientId, name, redirectUris, scopes });
  await store.audit({
    event: "client_registered",
    clientId,
    ipHash,
    detail: { name, redirectUris, scopes },
  });

  return json(
    {
      client_id: clientId,
      client_name: name,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: scopes.join(" "),
    },
    201,
  );
}
