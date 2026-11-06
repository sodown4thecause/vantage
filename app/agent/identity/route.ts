import {
  AGENT_POST_CLAIM_SCOPES,
  AGENT_PRE_CLAIM_SCOPES,
  agentAssertionKey,
  agentAssertionKeyId,
  agentOrigin,
  agentRegistrationEnabled,
  agentTokenPepper,
} from "@/lib/agent/config";
import { drizzleAgentStore } from "@/lib/agent/oauth/store";
import { createAnonymousRegistration, drizzleRegistrationStore } from "@/lib/agent/registration";
import { agentIpHash, agentRateLimit } from "@/lib/agent/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

/**
 * auth.md registration. Anonymous only: `service_auth` and `identity_assertion`
 * are refused with the protocol's own error codes so a client can fall back.
 */
export async function POST(req: Request) {
  if (!agentRegistrationEnabled()) return new Response("Not found", { status: 404 });

  const origin = agentOrigin();
  const signingKey = agentAssertionKey();
  const pepper = agentTokenPepper();
  if (!origin || !signingKey || !pepper) {
    return json({ error: "server_error", error_description: "Not configured." }, 503);
  }

  const ipHash = await agentIpHash(req);
  if (!(await agentRateLimit("agent-identity", ipHash ?? "unknown"))) {
    return Response.json(
      { error: "rate_limited", error_description: "Too many registrations. Try again shortly." },
      { status: 429, headers: { "retry-after": "60", "cache-control": "no-store" } },
    );
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const type = typeof body?.type === "string" ? body.type : "";
  if (type === "service_auth") {
    return json(
      { error: "service_auth_not_enabled", error_description: "This service accepts anonymous registration only." },
      400,
    );
  }
  if (type === "identity_assertion") {
    return json(
      { error: "issuer_not_enabled", error_description: "This service accepts anonymous registration only." },
      400,
    );
  }
  if (type !== "anonymous") {
    return json({ error: "invalid_request", error_description: 'type must be "anonymous".' }, 400);
  }

  const result = await createAnonymousRegistration({
    store: drizzleRegistrationStore(),
    origin,
    signingKey,
    keyId: agentAssertionKeyId(),
    pepper,
    ipHash,
    now: new Date(),
  });
  if (!result.ok) {
    return json(
      {
        error: result.error,
        error_description:
          result.error === "rate_limited"
            ? "Too many registrations from this address today."
            : "The daily registration quota is spent.",
      },
      result.error === "rate_limited" ? 429 : 503,
    );
  }

  await drizzleAgentStore().audit({
    event: "agent_registered",
    registrationId: result.registrationId,
    ipHash,
    detail: { type: "anonymous" },
  });

  return json(
    {
      registration_id: result.registrationId,
      registration_type: "anonymous",
      identity_assertion: result.assertion,
      assertion_expires: result.assertionExpires.toISOString(),
      pre_claim_scopes: [...AGENT_PRE_CLAIM_SCOPES],
      claim_url: `${origin}/agent/identity/claim`,
      claim_token: result.claimToken,
      claim_token_expires: result.claimTokenExpires.toISOString(),
      post_claim_scopes: [...AGENT_POST_CLAIM_SCOPES],
    },
    200,
  );
}
