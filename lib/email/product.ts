import { and, eq, isNull } from "drizzle-orm";

import { appUrl } from "@/lib/app-url";
import { getDb } from "@/lib/db/client";
import { productEmailSent, workspace } from "@/lib/db/schema";
import { unsubscribeToken } from "@/lib/email/unsubscribe";
import { digestFromAddress, digestFromName, resendApiKey } from "@/lib/env/server";

export type ProductEmailResult =
  | { ok: true; skipped?: false }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; error: string };

export async function sendProductEmail(input: {
  workspaceId: string; to: string; idempotencyKey: string; once?: string; apiKey?: string; digest?: boolean;
  render: (unsubscribeUrl: string) => { subject: string; text: string; html: string };
}): Promise<ProductEmailResult> {
  const apiKey = input.apiKey ?? resendApiKey();
  if (!apiKey) return { ok: true, skipped: true, reason: "no api key" };
  let claimed = false;
  let delivered = false;
  let releaseClaim = false;
  try {
    const db = getDb();
    // Digests need opt-in delivery to this address; activation mail needs only that the workspace has not unsubscribed.
    const permitted = and(eq(workspace.id, input.workspaceId), isNull(workspace.productEmailSuppressedAt),
      input.digest ? and(eq(workspace.digestEnabled, true), eq(workspace.digestEmail, input.to)) : undefined);
    const [ws] = await db.select({ id: workspace.id }).from(workspace).where(permitted).limit(1);
    if (!ws) return { ok: true, skipped: true, reason: "delivery disabled or suppressed" };
    const unsubscribeUrl = `${appUrl()}/api/email/unsubscribe?token=${unsubscribeToken(input.workspaceId)}`;
    const content = input.render(unsubscribeUrl);
    if (input.once) {
      const [claim] = await db.insert(productEmailSent).values({ workspaceId: input.workspaceId, kind: input.once })
        .onConflictDoNothing().returning({ kind: productEmailSent.kind });
      if (!claim) return { ok: true, skipped: true, reason: "already claimed" };
      claimed = true;
    }
    const [stillPermitted] = await db.select({ id: workspace.id }).from(workspace).where(permitted).limit(1);
    if (!stillPermitted) {
      releaseClaim = true;
      return { ok: true, skipped: true, reason: "delivery disabled or suppressed" };
    }
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST", signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "Idempotency-Key": input.idempotencyKey },
      body: JSON.stringify({ from: `${digestFromName()} <${digestFromAddress()}>`, to: [input.to], ...content,
        headers: { "List-Unsubscribe": `<mailto:${digestFromAddress()}?subject=unsubscribe>, <${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } }),
    });
    if (!response.ok) {
      releaseClaim = response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 409;
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, error: "email provider rejected the message" };
    }
    delivered = true;
    await response.body?.cancel().catch(() => undefined);
    if (input.once) await db.update(productEmailSent).set({ sentAt: new Date() })
      .where(and(eq(productEmailSent.workspaceId, input.workspaceId), eq(productEmailSent.kind, input.once)));
    return { ok: true };
  } catch {
    console.error("[product-email] delivery failed", { workspaceId: input.workspaceId });
    return { ok: false, error: "email send failed" };
  } finally {
    if (claimed && releaseClaim && !delivered && input.once) {
      try {
        await getDb().delete(productEmailSent).where(and(
          eq(productEmailSent.workspaceId, input.workspaceId), eq(productEmailSent.kind, input.once), isNull(productEmailSent.sentAt),
        ));
      } catch {
        console.error("[product-email] claim release failed", { workspaceId: input.workspaceId });
      }
    }
  }
}
