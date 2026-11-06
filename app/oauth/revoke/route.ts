import { agentRegistrationEnabled, agentTokenPepper } from "@/lib/agent/config";
import { revokeToken } from "@/lib/agent/oauth/flow";
import { drizzleAgentStore } from "@/lib/agent/oauth/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** RFC 7009. Always 200, so a caller cannot probe which tokens exist. */
export async function POST(req: Request) {
  if (!agentRegistrationEnabled()) return new Response("Not found", { status: 404 });
  const pepper = agentTokenPepper();
  if (!pepper) return new Response("Not configured", { status: 503 });

  const form = await req.formData().catch(() => null);
  const token = form?.get("token");
  if (typeof token === "string" && token.trim()) {
    const store = drizzleAgentStore();
    await revokeToken(store, { token: token.trim(), pepper, now: new Date() });
    await store.audit({ event: "token_revoked", detail: { hint: String(form?.get("token_type_hint") ?? "") } });
  }
  return new Response(null, { status: 200, headers: { "cache-control": "no-store" } });
}
