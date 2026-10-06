import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { roundUsd } from "@/lib/costs/ledger";

export const DEFAULT_PUBLIC_DAILY_BUDGET_USD = 5;

/** UTC calendar day, `YYYY-MM-DD`. */
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function publicDailyBudgetUsd(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = Number(env.PUBLIC_DAILY_BUDGET_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_PUBLIC_DAILY_BUDGET_USD;
}

/** What a successful guard reserved: pinned to the UTC day it was reserved on. */
export type BudgetReservation = { day: string; estimateUsd: number };

export function assertValidUsd(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative finite number`);
  }
}

export function rowsOf(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? rows : [];
}

/**
 * Reserve `estimateUsd` against today's budget in ONE atomic statement
 * (neon-http has no interactive transactions). The upsert only writes when the
 * new total stays within the cap, so concurrent callers can never overspend.
 * Returns false when the budget is exhausted.
 */
export async function reservePublicBudget(
  estimateUsd: number,
  opts: { day?: string; capUsd?: number } = {},
): Promise<boolean> {
  assertValidUsd(estimateUsd, "estimateUsd");
  const day = opts.day ?? utcDay();
  const cap = roundUsd(opts.capUsd ?? publicDailyBudgetUsd()).toFixed(6);
  const est = roundUsd(estimateUsd).toFixed(6);
  const result = await getDb().execute(sql`
    insert into budget_day (day, spent_usd, cap_usd)
    select ${day}::date, ${est}::numeric, ${cap}::numeric
    where ${est}::numeric <= ${cap}::numeric
    on conflict (day) do update
      set spent_usd = budget_day.spent_usd + ${est}::numeric,
          cap_usd = excluded.cap_usd
      where budget_day.spent_usd + ${est}::numeric <= excluded.cap_usd
    returning spent_usd
  `);
  return rowsOf(result).length > 0;
}

async function adjustSpend(day: string, deltaUsd: number): Promise<void> {
  const delta = roundUsd(deltaUsd).toFixed(6);
  await getDb().execute(sql`
    update budget_day
    set spent_usd = greatest(0, spent_usd + ${delta}::numeric)
    where day = ${day}::date
  `);
}

/** Give back a reservation whose work failed or never ran (uses the reserved day). */
export async function refundPublicSpend(reservation: BudgetReservation): Promise<void> {
  await adjustSpend(reservation.day, -reservation.estimateUsd);
}

/**
 * Settle a reservation against what was actually spent: adds
 * `actualUsd - estimateUsd` (never below zero) to the day it was reserved on.
 */
export async function settlePublicSpend(
  reservation: BudgetReservation,
  actualUsd: number,
): Promise<void> {
  assertValidUsd(actualUsd, "actualUsd");
  await adjustSpend(reservation.day, actualUsd - reservation.estimateUsd);
}

/** Sum the real cost recorded in `cost_event` for a request and settle it. */
export async function reconcilePublicSpend(
  requestRef: string,
  reservation: BudgetReservation,
): Promise<number> {
  const result = await getDb().execute(sql`
    select coalesce(sum(cost_usd), 0)::text as total
    from cost_event where request_ref = ${requestRef}
  `);
  const total = Number((rowsOf(result)[0] as { total?: string } | undefined)?.total ?? 0);
  const actual = Number.isFinite(total) ? total : 0;
  await settlePublicSpend(reservation, actual);
  return actual;
}

/**
 * Delete guard rows older than `retentionDays`. Nothing schedules this yet;
 * call it from the cron tick (or a later slice) to keep the tables small.
 */
export async function pruneOldPublicRows(retentionDays = 14): Promise<void> {
  const days = Math.max(1, Math.floor(retentionDays));
  await getDb().execute(sql`delete from public_visitor where day < current_date - ${days}::int`);
  await getDb().execute(sql`delete from budget_day where day < current_date - ${days}::int`);
}
