import { agentOrigin, agentRegistrationEnabled } from "@/lib/agent/config";
import { authorizationServerMetadata } from "@/lib/agent/oauth/metadata";

export const dynamic = "force-dynamic";

/** RFC 8414. Served at /.well-known/oauth-authorization-server via a rewrite. */
export async function GET() {
  if (!agentRegistrationEnabled()) return new Response("Not found", { status: 404 });
  const origin = agentOrigin();
  if (!origin) return new Response("Not configured", { status: 503 });
  return Response.json(authorizationServerMetadata(origin), {
    headers: { "cache-control": "public, max-age=300" },
  });
}
