import {
  AGENT_CLAIM_POLL_INTERVAL_SECONDS,
  AGENT_USER_CODE_TTL_SECONDS,
  agentOrigin,
  agentRegistrationEnabled,
  agentTokenPepper,
} from "@/lib/agent/config";
import { drizzleAgentStore } from "@/lib/agent/oauth/store";
import { drizzleRegistrationStore, initiateClaim } from "@/lib/agent/registration";
import { agentIpHash, agentRateLimit } from "@/lib/agent/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Starts a claim ceremony. The agent gets a 6-digit code and a link to hand to a
 * human; the code is never returned again.
 */
export async function POST(req: Request) {
  if (!agentRegistrationEnabled()) return new Response("Not found", { status: 404 });

  const origin = agentOrigin();
  const pepper = agentTokenPepper();
  if (!origin || !pepper) return json({ error: "server_error", error_description: "Not configured." }, 503);

  const ipHash = await agentIpHash(req);
  if (!(await agentRateLimit("agent-claim", ipHash ?? "unknown"))) {
    return Response.json(
      { error: "rate_limited", error_description: "Too many claim attempts." },
      { status: 429, headers: { "retry-after": "60", "cache-control": "no-store" } },
    );
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const claimToken = typeof body?.claim_token === "string" ? body.claim_token.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : null;
  if (!claimToken) {
    return json({ error: "invalid_request", error_description: "claim_token is required." }, 400);
  }
  if (email && !EMAIL.test(email)) {
    return json({ error: "invalid_request", error_description: "email is malformed." }, 400);
  }

  const result = await initiateClaim({
    store: drizzleRegistrationStore(),
    claimToken,
    email,
    pepper,
    origin,
    now: new Date(),
  });
  if (!result.ok) {
    return json(
      {
        error: result.error,
        error_description:
          result.error === "invalid_claim_token"
            ? "The claim token is wrong or expired. Register again."
            : result.error === "claimed_or_in_flight"
              ? "This registration is already claimed or in progress."
              : "The registration expired before it was claimed.",
      },
      400,
    );
  }

  await drizzleAgentStore().audit({
    event: "claim_initiated",
    registrationId: result.registrationId,
    ipHash,
    detail: { hasEmail: Boolean(email) },
  });

  return json(
    {
      registration_id: result.registrationId,
      claim_attempt_id: result.attemptId,
      status: "initiated",
      expires_at: result.expiresAt.toISOString(),
      claim_attempt: {
        user_code: result.userCode,
        expires_in: AGENT_USER_CODE_TTL_SECONDS,
        verification_uri: result.verificationUri,
        interval: AGENT_CLAIM_POLL_INTERVAL_SECONDS,
      },
    },
    200,
  );
}
