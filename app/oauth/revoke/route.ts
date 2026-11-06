import { agentRegistrationEnabled, agentTokenPepper } from "@/lib/agent/config";
import { revokeToken } from "@/lib/agent/oauth/flow";
import { drizzleAgentStore } from "@/lib/agent/oauth/store";
import { agentIpHash, agentRateLimit } from "@/lib/agent/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** RFC 7009. Always 200, so a caller cannot probe which tokens exist. */
export async function POST(req: Request) {
  if (!agentRegistrationEnabled()) return new Response("Not found", { status: 404 });
  const pepper = agentTokenPepper();
  if (!pepper) return new Response("Not configured", { status: 503 });

  // Rate limited before the store is touched: an unauthenticated caller must not
  // be able to grow the audit table with made-up tokens.
  const ipHash = await agentIpHash(req);
  if (!(await agentRateLimit("agent-revoke", ipHash ?? "unknown"))) {
    return new Response(null, { status: 429, headers: { "retry-after": "30" } });
  }

  const form = await req.formData().catch(() => null);
  const token = form?.get("token");
  if (typeof token === "string" && token.trim()) {
    const store = drizzleAgentStore();
    const revoked = await revokeToken(store, { token: token.trim(), pepper, now: new Date() });
    // Only a real revocation is worth a row; unknown tokens stay silent.
    if (revoked) {
      await store.audit({
        event: "token_revoked",
        ipHash,
        detail: { hint: String(form?.get("token_type_hint") ?? "") },
      });
    }
  }
  return new Response(null, { status: 200, headers: { "cache-control": "no-store" } });
}
