import { and, eq, gt, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { workspace } from "@/lib/db/schema";
import { sendProductEmail } from "@/lib/email/product";
import { captureActivation } from "@/lib/analytics/activation";
import type { DigestOpportunity } from "@/lib/digest/select";
import { safeHttpUrl } from "@/lib/http/safe-url";

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
  unsubscribeUrl?: string,
): { subject: string; html: string; text: string } {
  opportunities = opportunities.slice(0, 5);
  const subject = `Vantage: ${opportunities.length} conversation${
    opportunities.length === 1 ? "" : "s"
  } worth joining today`;

  const entries = opportunities.map((opportunity, index) => {
    const url = safeHttpUrl(opportunity.url);
    const title = `${index + 1}. ${opportunity.title ?? url ?? "Conversation"}`;
    const label = escapeHtml(title);
    let reviewUrl: string | undefined;
    const safeManage = safeHttpUrl(manageUrl);
    if (safeManage) {
      const manage = new URL(safeManage);
      const review = new URL(`/opportunities/${encodeURIComponent(opportunity.opportunityId)}`, manage.origin);
      review.searchParams.set("src", "email");
      const workspaceId = manage.searchParams.get("workspaceId");
      if (workspaceId) review.searchParams.set("workspaceId", workspaceId);
      reviewUrl = review.href;
    }
    const destination = reviewUrl ? `<a href="${escapeHtml(reviewUrl)}">${label}</a>` : label;
    return {
      html: `<li style="margin-bottom:12px">${destination}<br/><span style="color:#525252">${escapeHtml(opportunity.platform)} · score ${opportunity.score}${opportunity.reason ? ` · ${escapeHtml(opportunity.reason)}` : ""}</span>${url ? `<br/><a href="${escapeHtml(url)}">Original conversation</a>` : ""}</li>`,
      text: `${title} (${opportunity.platform}, score ${opportunity.score})${reviewUrl ? `\n   Review: ${reviewUrl}` : ""}${url ? `\n   Source: ${url}` : ""}`,
    };
  });
  const settingsUrl = safeHttpUrl(manageUrl);
  const settingsLink = settingsUrl
    ? `<a href="${escapeHtml(settingsUrl)}">Manage digest settings</a>`
    : "Manage digest settings";
  const safeUnsubscribe = unsubscribeUrl ? safeHttpUrl(unsubscribeUrl) : undefined;
  const html = `<div style="font-family:sans-serif;max-width:560px;margin:0 auto"><h2>Today&rsquo;s conversations</h2><ul style="padding-left:18px">${entries.map((entry) => entry.html).join("")}</ul><p style="color:#737373;font-size:13px">${settingsLink} to change your delivery time.${safeUnsubscribe ? ` <a href="${escapeHtml(safeUnsubscribe)}">Unsubscribe</a> from product emails.` : ""}</p></div>`;

  const text = [
    "Today's conversations",
    "",
    ...entries.map((entry) => entry.text),
    "",
    `Manage digest settings${settingsUrl ? `: ${settingsUrl}` : ""}`,
    ...(safeUnsubscribe ? [`Unsubscribe: ${safeUnsubscribe}`] : []),
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

  const result = await sendProductEmail({ workspaceId: input.workspaceId, to: input.to, apiKey: input.apiKey,
    idempotencyKey: `digest/${input.workspaceId}/${input.previousDigestLastSentAt?.toISOString() ?? "first"}`,
    render: (unsubscribeUrl) => renderDigestEmail(input.opportunities, input.manageUrl, unsubscribeUrl),
  });
  if (result.ok && !result.skipped) await captureActivation("digest_sent", input.workspaceId, { picked: Math.min(5, input.opportunities.length) });
  return result;
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
