import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { workspace } from "@/lib/db/schema";
import { digestFromAddress, digestFromName, resendApiKey } from "@/lib/env/server";
import type { DigestOpportunity } from "@/lib/digest/select";

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

  const items = opportunities
    .map(
      (o, index) =>
        `<li style="margin-bottom:12px"><a href="${escapeHtml(o.url)}">${index + 1}. ${escapeHtml(o.title ?? o.url)}</a><br/><span style="color:#525252">${escapeHtml(o.platform)} · score ${o.score}${o.reason ? ` · ${escapeHtml(o.reason)}` : ""}</span></li>`,
    )
    .join("");

  const html = `<div style="font-family:sans-serif;max-width:560px;margin:0 auto"><h2>Today&rsquo;s conversations</h2><ul style="padding-left:18px">${items}</ul><p style="color:#737373;font-size:13px"><a href="${escapeHtml(manageUrl)}">Manage digest settings</a> to unsubscribe or change your delivery time.</p></div>`;

  const text = [
    "Today's conversations",
    "",
    ...opportunities.map(
      (o, i) =>
        `${i + 1}. ${o.title ?? o.url} (${o.platform}, score ${o.score})\n   ${o.url}`,
    ),
    "",
    `Manage digest settings: ${manageUrl}`,
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
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
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
      const detail = await response.text().catch(() => "");
      console.error("[digest] resend rejected", {
        workspaceId: input.workspaceId,
        status: response.status,
        detail: detail.slice(0, 200),
      });
      return { ok: false, error: "email provider rejected the digest" };
    }
    return { ok: true };
  } catch (err) {
    console.error("[digest] send failed", {
      workspaceId: input.workspaceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "email send failed" };
  }
}

/** Record that a digest went out, so the next one is at least a day later. */
export async function markDigestSent(
  workspaceId: string,
  at: Date,
): Promise<void> {
  const db = getDb();
  await db
    .update(workspace)
    .set({ digestLastSentAt: at })
    .where(eq(workspace.id, workspaceId));
}
