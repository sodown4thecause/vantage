import {
  AGENT_TRIAL_DRAFT_ATTEMPTS,
  AGENT_TRIAL_TOOL_CALLS,
  agentOrigin,
  agentRegistrationEnabled,
  agentTokenPepper,
} from "@/lib/agent/config";
import { authenticateMcpRequest } from "@/lib/agent/mcp/auth";
import {
  MCP_SUPPORTED_PROTOCOL_VERSIONS,
  handleMcpMessage,
} from "@/lib/agent/mcp/protocol";
import { agentTools } from "@/lib/agent/mcp/tools";
import { drizzleAgentStore } from "@/lib/agent/oauth/store";
import { drizzleRegistrationStore } from "@/lib/agent/registration";
import { authorizeWorkspace } from "@/lib/auth/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response("Not found", { status: 404 });

function isDraftCall(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const message = body as Record<string, unknown>;
  if (message.method !== "tools/call") return false;
  const params = message.params;
  return typeof params === "object" && params !== null && (params as Record<string, unknown>).name === "draft_reply";
}

const quotaExceeded = (message: string) =>
  Response.json(
    { jsonrpc: "2.0", id: null, error: { code: -32000, message } },
    { status: 429, headers: { "cache-control": "no-store" } },
  );

/**
 * Streamable HTTP MCP endpoint. Stateless: no session id is issued, so each
 * request carries its own bearer token. GET (server-initiated SSE) is not
 * offered, which the transport permits.
 *
 * Authorization: `authorizeWorkspace` checks that a Neon Auth *session* owns the
 * workspace, and an agent has no session. The equivalent check here is the
 * bearer token plus workspace scoping, both required before any write:
 *
 *   1. `authenticateMcpRequest` proves the token is live and unrevoked.
 *   2. Every write below is scoped by `auth.token.workspaceId`, so a token can
 *      only touch the workspace it was issued for.
 *
 * This follows the existing bearer-token routes under /api/internal/scan, which
 * authorize with `isCronAuthorized` rather than a session.
 */
export async function POST(req: Request) {
  if (!agentRegistrationEnabled()) return NOT_FOUND();
  const origin = agentOrigin();
  const pepper = agentTokenPepper();
  const store = drizzleAgentStore();

  const registrations = drizzleRegistrationStore();
  const auth = await authenticateMcpRequest(req, store, {
    pepper,
    origin,
    now: new Date(),
    registrationStatus: async (registrationId) =>
      (await registrations.findRegistration(registrationId))?.status ?? null,
  });
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

  // Trial quotas are durable counters, checked before any tool runs.
  if (auth.token.registrationId && auth.token.workspaceId) {
    // The canonical workspace check, before any write. An agent has no session,
    // so it passes its verified registration instead; the function confirms the
    // registration is still active and bound to this workspace.
    const authorization = await authorizeWorkspace(auth.token.workspaceId, {
      registrationId: auth.token.registrationId,
      workspaceId: auth.token.workspaceId,
    });
    if (!authorization.ok) {
      return Response.json(
        { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Not authorized for this workspace." } },
        { status: authorization.status, headers: { "cache-control": "no-store" } },
      );
    }

    const registrations = drizzleRegistrationStore();
    const now = new Date();
    const deny = async (quota: "draft_attempts" | "tool_calls", message: string) => {
      // Every denial is recorded, so an operator can see when and why a trial
      // was blocked. No token, code or content is stored.
      await store.audit({
        event: "quota_denied",
        registrationId: auth.token.registrationId,
        workspaceId: auth.token.workspaceId,
        detail: { quota },
      });
      return quotaExceeded(message);
    };
    if (
      isDraftCall(body) &&
      !(await registrations.consumeDraftAttempt(
        auth.token.registrationId,
        auth.token.workspaceId,
        AGENT_TRIAL_DRAFT_ATTEMPTS,
        now,
      ))
    ) {
      return deny(
        "draft_attempts",
        "The trial's draft quota is spent. Claim the workspace to continue.",
      );
    }
    if (
      !(await registrations.consumeToolCall(
        auth.token.registrationId,
        auth.token.workspaceId,
        AGENT_TRIAL_TOOL_CALLS,
        now,
      ))
    ) {
      return deny(
        "tool_calls",
        "The trial's tool-call quota is spent. Claim the workspace to continue.",
      );
    }
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
  if (!agentRegistrationEnabled()) return NOT_FOUND();
  return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } });
}

export async function DELETE() {
  if (!agentRegistrationEnabled()) return NOT_FOUND();
  return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } });
}
