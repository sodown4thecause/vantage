import { agentOrigin, agentRegistrationEnabled, agentTokenPepper } from "@/lib/agent/config";
import { authenticateMcpRequest } from "@/lib/agent/mcp/auth";
import {
  MCP_SUPPORTED_PROTOCOL_VERSIONS,
  handleMcpMessage,
} from "@/lib/agent/mcp/protocol";
import { agentTools } from "@/lib/agent/mcp/tools";
import { drizzleAgentStore } from "@/lib/agent/oauth/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response("Not found", { status: 404 });

/**
 * Streamable HTTP MCP endpoint. Stateless: no session id is issued, so each
 * request carries its own bearer token. GET (server-initiated SSE) is not
 * offered, which the transport permits.
 */
export async function POST(req: Request) {
  if (!agentRegistrationEnabled()) return NOT_FOUND();
  const origin = agentOrigin();
  const pepper = agentTokenPepper();
  const store = drizzleAgentStore();

  const auth = await authenticateMcpRequest(req, store, { pepper, origin, now: new Date() });
  if (!auth.ok) {
    const headers: Record<string, string> = { "cache-control": "no-store" };
    if (auth.challenge) headers["www-authenticate"] = auth.challenge;
    return Response.json(auth.body, { status: auth.status, headers });
  }

  const version = req.headers.get("mcp-protocol-version");
  if (version && !(MCP_SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(version)) {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Unsupported MCP-Protocol-Version" } },
      { status: 400 },
    );
  }

  const body: unknown = await req.json().catch(() => undefined);
  if (body === undefined) {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400 },
    );
  }

  const outcome = await handleMcpMessage(
    body,
    { workspaceId: auth.token.workspaceId, userId: auth.token.userId, scopes: auth.token.scopes },
    agentTools(),
  );
  if (outcome.status === 202) return new Response(null, { status: 202 });
  return Response.json(outcome.body, { status: outcome.status });
}

export async function GET() {
  return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } });
}

export async function DELETE() {
  return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } });
}
