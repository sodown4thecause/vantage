import { and, eq, gt, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { workspace } from "@/lib/db/schema";
import { digestFromAddress, digestFromName, resendApiKey } from "@/lib/env/server";
import type { DigestOpportunity } from "@/lib/digest/select";
import { safeHttpUrl } from "@/lib/http/safe-url";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type DigestSendResult =
  | { ok: true; skipped?: false }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; error: string };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderDigestEmail(
  opportunities: DigestOpportunity[],
  manageUrl: string,
): { subject: string; html: string; text: string } {
  const subject = `Vantage: ${opportunities.length} conversation${
    opportunities.length === 1 ? "" : "s"
  } worth joining today`;

  const entries = opportunities.map((opportunity, index) => {
    const url = safeHttpUrl(opportunity.url);
    const title = `${index + 1}. ${opportunity.title ?? url ?? "Conversation"}`;
    const label = escapeHtml(title);
    const destination = url ? `<a href="${escapeHtml(url)}">${label}</a>` : label;
    return {
      html: `<li style="margin-bottom:12px">${destination}<br/><span style="color:#525252">${escapeHtml(opportunity.platform)} · score ${opportunity.score}${opportunity.reason ? ` · ${escapeHtml(opportunity.reason)}` : ""}</span></li>`,
      text: `${title} (${opportunity.platform}, score ${opportunity.score})${url ? `\n   ${url}` : ""}`,
    };
  });
  const settingsUrl = safeHttpUrl(manageUrl);
  const settingsLink = settingsUrl
    ? `<a href="${escapeHtml(settingsUrl)}">Manage digest settings</a>`
    : "Manage digest settings";
  const html = `<div style="font-family:sans-serif;max-width:560px;margin:0 auto"><h2>Today&rsquo;s conversations</h2><ul style="padding-left:18px">${entries.map((entry) => entry.html).join("")}</ul><p style="color:#737373;font-size:13px">${settingsLink} to unsubscribe or change your delivery time.</p></div>`;

  const text = [
    "Today's conversations",
    "",
    ...entries.map((entry) => entry.text),
    "",
    `Manage digest settings${settingsUrl ? `: ${settingsUrl}` : ""}`,
  ].join("\n");

  return { subject, html, text };
}

/**
 * Send the daily digest via the Resend HTTP API. Skipped (not failed) when
 * no API key is configured or the workspace has no recipients.
 */
export async function sendDigestEmail(input: {
  to: string;
  workspaceId: string;
  previousDigestLastSentAt: Date | null;
  opportunities: DigestOpportunity[];
  manageUrl: string;
  apiKey?: string;
}): Promise<DigestSendResult> {
  if (!input.opportunities.length) {
    return { ok: true, skipped: true, reason: "no opportunities" };
  }

  const apiKey = input.apiKey ?? resendApiKey();
  if (!apiKey) {
    console.warn("[digest] skipped: RESEND_API_KEY is not configured");
    return { ok: true, skipped: true, reason: "no api key" };
  }

  const { subject, html, text } = renderDigestEmail(
    input.opportunities,
    input.manageUrl,
  );

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "Idempotency-Key": `digest/${input.workspaceId}/${input.previousDigestLastSentAt?.toISOString() ?? "first"}`,
      },
      body: JSON.stringify({
        from: `${digestFromName()} <${digestFromAddress()}>`,
        to: [input.to],
        subject,
        html,
        text,
      }),
    });

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      console.error("[digest] resend rejected", {
        workspaceId: input.workspaceId,
        status: response.status,
      });
      return { ok: false, error: "email provider rejected the digest" };
    }
    return { ok: true };
  } catch {
    console.error("[digest] send failed", {
      workspaceId: input.workspaceId,
    });
    return { ok: false, error: "email send failed" };
  }
}

/** Only the live claim owner may advance the successful delivery cycle. */
export async function markDigestSent(
  workspaceId: string,
  at: Date,
  token: string,
): Promise<boolean> {
  const [marked] = await getDb()
    .update(workspace)
    .set({ digestLastSentAt: at })
    .where(and(
      eq(workspace.id, workspaceId),
      eq(workspace.digestLeaseToken, token),
      gt(workspace.digestLeaseUntil, sql`now()`),
    ))
    .returning({ id: workspace.id });
  return Boolean(marked);
}
