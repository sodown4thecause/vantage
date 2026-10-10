import { eq } from "drizzle-orm";

import { appUrl } from "@/lib/app-url";
import { getDb } from "@/lib/db/client";
import { workspace } from "@/lib/db/schema";
import { isDigestDue } from "@/lib/digest/schedule";
import { markDigestSent, sendDigestEmail } from "@/lib/digest/send";
import { selectDigestOpportunities } from "@/lib/digest/select";

const MIN_DIGEST_INTERVAL_HOURS = 20;

export type DigestDispatchSummary = {
  checked: number;
  sent: number;
  skipped: number;
  failed: number;
};

/**
 * Send the daily digest to every workspace that has it enabled and is due.
 * A failure for one workspace is logged and counted, never thrown: the
 * sweep must complete for everyone else.
 */
export async function runDueDigests(
  now: Date = new Date(),
): Promise<DigestDispatchSummary> {
  const db = getDb();
  const dueSince = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const due = await db
    .select({
      id: workspace.id,
      digestEmail: workspace.digestEmail,
      digestHourUtc: workspace.digestHourUtc,
      digestLastSentAt: workspace.digestLastSentAt,
    })
    .from(workspace)
    .where(eq(workspace.digestEnabled, true));

  const summary: DigestDispatchSummary = {
    checked: due.length,
    sent: 0,
    skipped: 0,
    failed: 0,
  };

  for (const ws of due) {
    if (!ws.digestEmail) {
      summary.skipped += 1;
      continue;
    }
    const lastSentAt = ws.digestLastSentAt;
    if (
      lastSentAt &&
      now.getTime() - lastSentAt.getTime() <
        MIN_DIGEST_INTERVAL_HOURS * 60 * 60 * 1000
    ) {
      summary.skipped += 1;
      continue;
    }
    if (!isDigestDue({ digestHourUtc: ws.digestHourUtc, lastSentAt, now })) {
      summary.skipped += 1;
      continue;
    }

    const opportunities = await selectDigestOpportunities(ws.id, {
      since: dueSince,
    });

    const result = await sendDigestEmail({
      to: ws.digestEmail,
      workspaceId: ws.id,
      opportunities,
      manageUrl: `${appUrl()}/settings/digest?workspaceId=${ws.id}`,
    });

    if (!result.ok) {
      summary.failed += 1;
      continue;
    }
    if (result.skipped) {
      summary.skipped += 1;
      continue;
    }

    await markDigestSent(ws.id, now);
    summary.sent += 1;
  }

  return summary;
}
