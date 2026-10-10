import { and, asc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";

import { appUrl } from "@/lib/app-url";
import { getDb } from "@/lib/db/client";
import { workspace } from "@/lib/db/schema";
import { isDigestDue } from "@/lib/digest/schedule";
import { markDigestSent, sendDigestEmail } from "@/lib/digest/send";
import { selectDigestOpportunities } from "@/lib/digest/select";
import { resendApiKey } from "@/lib/env/server";

const DIGEST_BATCH_SIZE = 25;
const DISPATCH_BUDGET_MS = 90_000;
// Claim, three selection reads, ownership check, provider, mark and release: 10s each.
const WORKSPACE_BUDGET_MS = 80_000;

export type DigestDispatchSummary = {
  checked: number;
  sent: number;
  skipped: number;
  failed: number;
  hasMore: boolean;
};

/**
 * Rotate a bounded oldest-attempt-first due batch. Empty or failed digests
 * advance, while deferred work is picked up by a later cron invocation.
 * The claim returns current preferences; discovery is never trusted for send.
 */
export async function runDueDigests(
  now: Date = new Date(),
): Promise<DigestDispatchSummary> {
  const startedAt = Date.now();
  const db = getDb();
  const dueSince = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const todaySlot = sql`${dayStart.toISOString()}::timestamptz
    + make_interval(hours => greatest(0, least(23, ${workspace.digestHourUtc})))`;
  const latestSlot = sql`(${todaySlot} - case when ${todaySlot} > ${now.toISOString()}::timestamptz
    then interval '1 day' else interval '0 days' end)`;
  const eligible = and(
    eq(workspace.digestEnabled, true),
    sql`nullif(btrim(${workspace.digestEmail}), '') is not null`,
    or(isNull(workspace.digestLastSentAt), and(
      lt(workspace.digestLastSentAt, latestSlot),
      sql`${workspace.digestLastSentAt} <= ${now.toISOString()}::timestamptz - interval '20 hours'`,
    )),
  );
  const available = or(
    isNull(workspace.digestLeaseUntil),
    lt(workspace.digestLeaseUntil, sql`now()`),
  );
  const candidates = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(and(eligible, available))
    .orderBy(sql`${workspace.digestLastAttemptAt} asc nulls first`, asc(workspace.id))
    .limit(DIGEST_BATCH_SIZE + 1);

  const summary: DigestDispatchSummary = {
    checked: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    hasMore: candidates.length > DIGEST_BATCH_SIZE,
  };

  for (const candidate of candidates.slice(0, DIGEST_BATCH_SIZE)) {
    if (Date.now() - startedAt > DISPATCH_BUDGET_MS - WORKSPACE_BUDGET_MS) {
      summary.hasMore = true;
      break;
    }
    summary.checked += 1;
    const token = crypto.randomUUID();
    let claimed = false;
    try {
      const [ws] = await db
        .update(workspace)
        .set({
          digestLeaseToken: token,
          digestLeaseUntil: sql`now() + interval '2 minutes'`,
          digestLastAttemptAt: sql`now()`,
        })
        .where(and(eq(workspace.id, candidate.id), eligible, available))
        .returning({
          id: workspace.id,
          digestEmail: workspace.digestEmail,
          digestHourUtc: workspace.digestHourUtc,
          digestLastSentAt: workspace.digestLastSentAt,
        });
      if (!ws) {
        summary.skipped += 1;
        continue;
      }
      claimed = true;
      if (!ws.digestEmail || !isDigestDue({
        digestHourUtc: ws.digestHourUtc,
        lastSentAt: ws.digestLastSentAt,
        now,
      })) {
        summary.skipped += 1;
        continue;
      }

      const apiKey = resendApiKey();
      if (!apiKey) {
        summary.skipped += 1;
        continue;
      }
      const opportunities = await selectDigestOpportunities(ws.id, { since: dueSince });
      const [owned] = await db.select({ id: workspace.id }).from(workspace)
        .where(and(
          eq(workspace.id, ws.id),
          eq(workspace.digestLeaseToken, token),
          gt(workspace.digestLeaseUntil, sql`now()`),
        )).limit(1);
      if (!owned) {
        summary.failed += 1;
        continue;
      }
      const result = await sendDigestEmail({
        to: ws.digestEmail,
        workspaceId: ws.id,
        previousDigestLastSentAt: ws.digestLastSentAt,
        opportunities,
        apiKey,
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
      if (await markDigestSent(ws.id, now, token)) summary.sent += 1;
      else summary.failed += 1;
    } catch {
      summary.failed += 1;
      console.error("[digest] dispatch failed", { workspaceId: candidate.id });
    } finally {
      if (claimed) {
        try {
          await db.update(workspace)
            .set({ digestLeaseToken: null, digestLeaseUntil: null })
            .where(and(eq(workspace.id, candidate.id), eq(workspace.digestLeaseToken, token)));
        } catch {
          console.error("[digest] release failed", { workspaceId: candidate.id });
        }
      }
    }
  }
  return summary;
}
