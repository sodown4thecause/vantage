import { recordCost } from "@/lib/costs/ledger";
import { getUnitCost } from "@/lib/costs/prices";
import type { CostBillable } from "@/lib/db/schema";

/** Optional attribution passed down from collectors into provider clients. */
export type CostContext = { workspaceId?: string; sourceKey: string };

export type WithCostMeta<T> = {
  sourceKey: string;
  provider: string;
  action: string;
  workspaceId?: string | null;
  /** Billable units from the result; defaults to 1. */
  units?: (result: T) => number;
  /** Classify a returned (not thrown) result as a failed call: recorded ok=false. */
  isFailure?: (result: T) => boolean;
  billableTo?: CostBillable;
  chargedOnFailure?: boolean;
};

/**
 * Run a provider call and append one cost_event. Failures are recorded at zero
 * cost (unless chargedOnFailure) and the original error is always rethrown.
 * Ledger problems are swallowed and never alter the provider result.
 */
export async function withCost<T>(
  meta: WithCostMeta<T>,
  fn: () => Promise<T>,
): Promise<T> {
  let result: T;
  try {
    result = await fn();
  } catch (err) {
    await safeRecord(meta, { ok: false, units: 1 });
    throw err;
  }
  let units = 1;
  try {
    units = meta.units ? meta.units(result) : 1;
  } catch {
    units = 1;
  }
  let failed = false;
  try {
    failed = meta.isFailure ? meta.isFailure(result) : false;
  } catch {
    failed = false;
  }
  await safeRecord(meta, { ok: !failed, units });
  return result;
}

async function safeRecord<T>(
  meta: WithCostMeta<T>,
  r: { ok: boolean; units: number },
): Promise<void> {
  try {
    const unitCostUsd = await getUnitCost(meta.provider, meta.action);
    await recordCost({
      sourceKey: meta.sourceKey,
      provider: meta.provider,
      action: meta.action,
      workspaceId: meta.workspaceId,
      billableTo: meta.billableTo,
      chargedOnFailure: meta.chargedOnFailure,
      units: r.units,
      unitCostUsd,
      ok: r.ok,
    });
  } catch (err) {
    console.error("[cost] metering failed", {
      provider: meta.provider,
      action: meta.action,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
