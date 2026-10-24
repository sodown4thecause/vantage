import { eq } from "drizzle-orm";

import { captureActivation } from "@/lib/analytics/activation";
import { getDb } from "@/lib/db/client";
import { workspace } from "@/lib/db/schema";
import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!verifyUnsubscribeToken(token)) return new Response("This unsubscribe link is invalid or has expired.", { status: 400 });
  return new Response('<!doctype html><html lang="en-AU"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe from Vantage</title><main><h1>Unsubscribe from Vantage product emails</h1><p>This stops digests and activation emails for this workspace.</p><form method="post"><button type="submit">Unsubscribe</button></form></main></html>', {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "content-security-policy": "default-src 'none'; form-action 'self'; frame-ancestors 'none'" },
  });
}

export async function POST(req: Request) {
  const workspaceId = verifyUnsubscribeToken(new URL(req.url).searchParams.get("token") ?? "");
  if (!workspaceId) return new Response("Invalid or expired unsubscribe link.", { status: 400 });
  try {
    await getDb().update(workspace).set({ digestEnabled: false, productEmailSuppressedAt: new Date(), updatedAt: new Date() })
      .where(eq(workspace.id, workspaceId));
    await captureActivation("unsubscribe", workspaceId);
    return new Response("You’re unsubscribed from Vantage product emails for this workspace.", { headers: { "cache-control": "no-store" } });
  } catch {
    return new Response("Could not save your preference. Please try again.", { status: 503 });
  }
}
