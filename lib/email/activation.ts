import { eq } from "drizzle-orm";

import { appUrl } from "@/lib/app-url";
import { getDb } from "@/lib/db/client";
import { workspace } from "@/lib/db/schema";
import { sendProductEmail } from "@/lib/email/product";
import { nothingStrongReason } from "@/lib/scan/nothing-strong";

export function firstScanEmailChoice(picked: number, read = 0) {
  return picked > 0
    ? { subject: `Vantage: your first ${Math.min(5, picked)} conversation${picked === 1 ? " is" : "s are"} ready`, text: "Your first scan found conversations worth reviewing. Read the evidence before deciding what to say." }
    : { subject: "Vantage: nothing strong yet", text: `Your first scan found no strong conversations. ${nothingStrongReason(read) === "few_sources" ? "Few sources are configured; check your sources or add one." : "Your topics may be too narrow; try broader wording in your profile."} We won’t fill the queue with placeholder picks.` };
}

export async function sendFirstScanEmail(workspaceId: string, picked: number, read = 0) {
  const [ws] = await getDb().select({ email: workspace.activationEmail }).from(workspace).where(eq(workspace.id, workspaceId)).limit(1);
  if (!ws?.email) return;
  const content = firstScanEmailChoice(picked, read);
  const queueUrl = `${appUrl()}/queue?workspaceId=${encodeURIComponent(workspaceId)}`;
  return sendProductEmail({ workspaceId, to: ws.email, once: "first_scan", idempotencyKey: `activation/first/${workspaceId}`,
    render: (unsubscribeUrl) => ({ subject: content.subject,
      text: `${content.text}\n\nReview your queue: ${queueUrl}\n\nUnsubscribe: ${unsubscribeUrl}`,
      html: `<h1>${content.subject}</h1><p>${content.text}</p><p><a href="${queueUrl}">Review your queue</a></p><p><a href="${unsubscribeUrl}">Unsubscribe</a></p>`,
    }),
  });
}

export async function sendWelcomeEmail(workspaceId: string, to: string) {
  const text = "Thanks for signing up. Finish your product setup and Vantage starts your first scan.";
  return sendProductEmail({ workspaceId, to, once: "welcome", idempotencyKey: `activation/welcome/${workspaceId}`,
    render: (unsubscribeUrl) => ({ subject: "Welcome to Vantage",
      text: `${text}\n\nUnsubscribe: ${unsubscribeUrl}`,
      html: `<p>${text}</p><p><a href="${unsubscribeUrl}">Unsubscribe</a></p>`,
    }),
  });
}
