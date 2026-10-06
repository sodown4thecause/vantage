import { getDb } from "@/lib/db/client";
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
  return Math.round(value * USD_SCALE) / USD_SCALE;
}

export function computeCost(input: CostInput): CostRow {
  const units = input.units ?? 1;
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
