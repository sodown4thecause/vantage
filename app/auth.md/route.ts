import { agentOrigin, agentRegistrationEnabled } from "@/lib/agent/config";
import { authMarkdown } from "@/lib/agent/oauth/metadata";

export const dynamic = "force-dynamic";

/** The auth.md skill document an agent reads before connecting. */
export async function GET() {
  if (!agentRegistrationEnabled()) return new Response("Not found", { status: 404 });
  const origin = agentOrigin();
  if (!origin) return new Response("Not configured", { status: 503 });
  return new Response(authMarkdown(origin), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
