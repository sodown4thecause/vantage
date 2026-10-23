import { and, count, eq, gte, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { rowsOf } from "@/lib/db/rows";
import { costEvent, type CostBillable } from "@/lib/db/schema";

export type CostInput = {
  sourceKey: string;
  provider: string;
  action: string;
  /** Billable units (requests, posts fetched, steps, browser seconds ...). */
  units?: number;
  /** Provider price per unit in USD. */
  unitCostUsd: number;
  workspaceId?: string | null;
  billableTo?: CostBillable;
  requestRef?: string | null;
  /** Failed calls the provider does not charge for are recorded at zero cost. */
  ok?: boolean;
  /** Set when the provider charges even though the call failed. */
  chargedOnFailure?: boolean;
};

export type CostRow = {
  units: string;
  unitCostUsd: string;
  costUsd: string;
};

const USD_SCALE = 1_000_000;

/** Round to 6 decimal places, matching numeric(12,6), without float drift in the output. */
export function roundUsd(value: number): number {
  // toPrecision(15) strips float noise so exact half-micro ties (7.499999999999999 vs 7.5) round up.
  return Math.round(Number((value * USD_SCALE).toPrecision(15))) / USD_SCALE;
}

export function computeCost(input: CostInput): CostRow {
  const rawUnits = input.units ?? 1;
  // Quantize to cost_event.units (numeric(14,4)) so units * unit_cost_usd reproduces the stored total.
  const units = Number.isFinite(rawUnits) ? Math.round(rawUnits * 10_000) / 10_000 : rawUnits;
  if (!Number.isFinite(units) || units < 0) {
    throw new Error("units must be a non-negative number");
  }
  if (!Number.isFinite(input.unitCostUsd) || input.unitCostUsd < 0) {
    throw new Error("unitCostUsd must be a non-negative number");
  }
  const ok = input.ok ?? true;
  const charged = ok || input.chargedOnFailure === true;
  // Price the row from the unit price that is actually stored (6 dp), so
  // units * unit_cost_usd always reproduces cost_usd.
  const unitCostUsd = roundUsd(input.unitCostUsd);
  const total = charged ? roundUsd(units * unitCostUsd) : 0;
  return {
    units: String(units),
    unitCostUsd: unitCostUsd.toFixed(6),
    costUsd: total.toFixed(6),
  };
}

/**
 * Append one cost row. A ledger failure must never break a collection run, so
 * errors are logged and swallowed; the return value says whether the row landed.
 */
export async function recordCost(input: CostInput): Promise<boolean> {
  try {
    const row = computeCost(input);
    await getDb().insert(costEvent).values({
      sourceKey: input.sourceKey,
      provider: input.provider,
      action: input.action,
      workspaceId: input.workspaceId ?? null,
      billableTo: input.billableTo ?? "platform",
      requestRef: input.requestRef ?? null,
      ok: input.ok ?? true,
      ...row,
    });
    return true;
  } catch (err) {
    console.error("[cost] failed to record cost event", {
      provider: input.provider,
      action: input.action,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/** Cost rows recorded so far today (UTC) for one workspace, provider and action. Failed attempts count too. */
export async function countCostEventsToday(input: {
  workspaceId: string;
  provider: string;
  action: string;
}): Promise<number> {
  const startOfDay = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  const [row] = await getDb()
    .select({ total: count() })
    .from(costEvent)
    .where(and(
      eq(costEvent.workspaceId, input.workspaceId),
      eq(costEvent.provider, input.provider),
      eq(costEvent.action, input.action),
      gte(costEvent.ts, startOfDay),
    ));
  return Number(row?.total ?? 0);
}

export async function reserveCostAttemptToday(input: {
  workspaceId: string; provider: string; action: string; max: number;
}): Promise<boolean> {
  if (!Number.isSafeInteger(input.max) || input.max <= 0) return false;
  const day = new Date().toISOString().slice(0, 10);
  return rowsOf(await getDb().execute(sql`
    insert into workspace_provider_quota (workspace_id, day, provider, action, attempts)
    select ${input.workspaceId}::uuid, ${day}::date, ${input.provider}::text, ${input.action}::text, count(*) + 1
    from cost_event
    where workspace_id = ${input.workspaceId}::uuid and provider = ${input.provider}::text
      and action = ${input.action}::text and ts >= (${day}::date::timestamp at time zone 'UTC')
    having count(*) < ${input.max}::integer
    on conflict (workspace_id, day, provider, action) do update
      set attempts = workspace_provider_quota.attempts + 1
      where workspace_provider_quota.attempts < ${input.max}::integer
    returning attempts
  `)).length > 0;
}
