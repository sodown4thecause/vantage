import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { numericField, rowsOf } from "@/lib/db/rows";
import { leadMagnetScan } from "@/lib/db/schema";
import { publicDailyBudgetUsd, utcDay } from "@/lib/public/budget";
import { FREE_SCAN_LIMITS, FREE_SCAN_ESTIMATE_USD } from "@/lib/lead-magnet/definition";

export type FreeScanCapResult =
  | { allowed: true }
  | { allowed: false; reason: "per_user_limit"; retryAfterDay: string };

/**
 * Atomically claim one free basic scan for the workspace on the given UTC day.
 * Single guarded upsert: neon-http has no interactive transactions, so the cap
 * is read inside the same statement and concurrent callers cannot both pass.
 * Returns `allowed: false` (and consumes nothing) when the cap is reached.
 */
export async function claimFreeScan(
  workspaceId: string,
  now: Date = new Date(),
): Promise<FreeScanCapResult> {
  const day = utcDay(now);
  const cap = FREE_SCAN_LIMITS.perUserPerDay;
  const result = await getDb().execute(sql`
    insert into "lead_magnet_scan" ("workspace_id", "day", "scans")
    select ${workspaceId}::uuid, ${day}::date, 1
    where ${cap}::int >= 1
    on conflict ("workspace_id", "day") do update
      set "scans" = "lead_magnet_scan"."scans" + 1, "updated_at" = now()
      where "lead_magnet_scan"."scans" < ${cap}::int
    returning "scans"
  `);
  if (rowsOf(result).length > 0) return { allowed: true };
  return { allowed: false, reason: "per_user_limit", retryAfterDay: day };
}

/** Give back a claimed scan when the work it paid for never ran (cap never drops below zero). */
export async function releaseFreeScan(
  workspaceId: string,
  now: Date = new Date(),
): Promise<void> {
  const day = utcDay(now);
  try {
    await getDb().execute(sql`
      update "lead_magnet_scan"
      set "scans" = greatest("scans" - 1, 0), "updated_at" = now()
      where "workspace_id" = ${workspaceId}::uuid and "day" = ${day}::date
    `);
  } catch (err) {
    console.error("[lead-magnet] release failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export type BudgetClaim =
  | { allowed: true; reservation: { day: string; estimateUsd: number } }
  | { allowed: false; reason: "budget_exhausted" };

/**
 * Reserve the free scan's estimated cost against the global daily budget. This
 * is the S06 `budget_day` table; the free basic scan deliberately shares the
 * platform-wide cap so free accounts cannot outspend the platform budget.
 * Returns `budget_exhausted` (a "queued for tomorrow" state, never an error).
 */
export async function reserveFreeScanBudget(
  estimateUsd: number = FREE_SCAN_ESTIMATE_USD,
  opts: { day?: string; capUsd?: number } = {},
): Promise<BudgetClaim> {
  const day = opts.day ?? utcDay();
  const cap = opts.capUsd ?? publicDailyBudgetUsd();
  const est = Math.max(0, estimateUsd);
  const result = await getDb().execute(sql`
    insert into "budget_day" ("day", "spent_usd", "cap_usd")
    select ${day}::date, ${est}::numeric, ${cap}::numeric
    where ${est}::numeric <= ${cap}::numeric
    on conflict ("day") do update
      set "spent_usd" = "budget_day"."spent_usd" + ${est}::numeric,
          "cap_usd" = excluded."cap_usd"
      where "budget_day"."spent_usd" + ${est}::numeric <= excluded."cap_usd"
    returning "spent_usd"
  `);
  if (rowsOf(result).length > 0) {
    return { allowed: true, reservation: { day, estimateUsd: est } };
  }
  return { allowed: false, reason: "budget_exhausted" };
}

/** Give back a budget reservation whose scan failed or never ran. Caller owns `day`. */
export async function refundFreeScanBudget(day: string, estimateUsd: number): Promise<void> {
  const delta = Math.max(0, estimateUsd);
  await getDb().execute(sql`
    update "budget_day"
    set "spent_usd" = greatest(0, "spent_usd" - ${delta}::numeric)
    where "day" = ${day}::date
  `);
}

/** Read-only view of how many free scans the workspace has used today (for UI copy). */
export async function freeScansUsedToday(
  workspaceId: string,
  now: Date = new Date(),
): Promise<number> {
  const day = utcDay(now);
  const rows = await getDb()
    .select({ scans: leadMagnetScan.scans })
    .from(leadMagnetScan)
    .where(sql`${leadMagnetScan.workspaceId} = ${workspaceId} and ${leadMagnetScan.day} = ${day}`)
    .limit(1);
  const raw = Array.isArray(rows) ? rows[0]?.scans : undefined;
  return numericField({ scans: raw }, "scans") ?? 0;
}
