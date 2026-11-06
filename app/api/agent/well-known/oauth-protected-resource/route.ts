import { agentOrigin, agentRegistrationEnabled } from "@/lib/agent/config";
import { protectedResourceMetadata } from "@/lib/agent/oauth/metadata";

export const dynamic = "force-dynamic";

/** RFC 9728. Served at /.well-known/oauth-protected-resource via a rewrite. */
export async function GET() {
  if (!agentRegistrationEnabled()) return new Response("Not found", { status: 404 });
  const origin = agentOrigin();
  if (!origin) return new Response("Not configured", { status: 503 });
  return Response.json(protectedResourceMetadata(origin), {
    headers: { "cache-control": "public, max-age=300" },
  });
}
