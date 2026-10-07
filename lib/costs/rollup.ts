import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";

/** `YYYY-MM-DD` in UTC. */
export function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Rebuild cost_daily for one UTC day from cost_event in a single atomic
 * statement. Idempotent: totals are recomputed (not incremented), so running
 * twice gives the same rows.
 */
export async function rollupDay(day: string): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error("day must be YYYY-MM-DD");
  }
  await getDb().execute(sql`
    INSERT INTO cost_daily (day, source_key, provider, action, calls, cost_usd, failed)
    SELECT ${day}::date, source_key, provider, action,
           count(*)::int, coalesce(sum(cost_usd), 0), (count(*) FILTER (WHERE NOT ok))::int
    FROM cost_event
    WHERE ts >= (${day}::date)::timestamp AT TIME ZONE 'UTC'
      AND ts < ((${day}::date + 1)::timestamp AT TIME ZONE 'UTC')
    GROUP BY source_key, provider, action
    ON CONFLICT (day, source_key, provider, action) DO UPDATE
      SET calls = EXCLUDED.calls, cost_usd = EXCLUDED.cost_usd, failed = EXCLUDED.failed
  `);
}

/** Best effort: yesterday (final) and today (partial). Never throws. */
export async function rollupRecent(now: Date = new Date()): Promise<void> {
  const today = utcDay(now);
  const yesterday = utcDay(new Date(now.getTime() - 86_400_000));
  for (const day of [yesterday, today]) {
    try {
      await rollupDay(day);
    } catch (err) {
      console.error("[cost] rollup failed", {
        day,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
