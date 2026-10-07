import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { rowsOf } from "@/lib/db/rows";
import { recordCost, roundUsd } from "@/lib/costs/ledger";
import type { CostContext } from "@/lib/costs/meter";

export class PaidCallDeniedError extends Error {
  constructor(public readonly code: "provider_disabled" | "budget_exhausted" | "access_pending", message: string) {
    super(message);
    this.name = "PaidCallDeniedError";
  }
}
export function isPaidCallDenied(error: unknown): error is PaidCallDeniedError {
  return error instanceof PaidCallDeniedError;
}

type PaidResult<T> = { value: T; costUsd?: number; error?: never }
  | { error: Error; costUsd?: number; value?: never };

/** One reservation and ledger row per outbound paid attempt; ambiguous failures stay charged. */
export async function runPaidCall<T>(meta: {
  context: CostContext; provider: string; action: string; estimateUsd: number; signal?: AbortSignal;
}, work: () => Promise<PaidResult<T>>): Promise<T> {
  meta.signal?.throwIfAborted();
  if (process.env.VANTAGE_PAID_PROVIDERS_ENABLED !== "true") {
    throw new PaidCallDeniedError("provider_disabled", "Paid providers are disabled.");
  }
  if (!meta.context.workspaceId) throw new PaidCallDeniedError("access_pending", "Paid calls require workspace attribution.");
  const cap = Number(process.env.VANTAGE_PAID_DAILY_BUDGET_USD);
  const estimate = roundUsd(meta.estimateUsd);
  if (!Number.isFinite(cap) || cap <= 0 || !Number.isFinite(estimate) || estimate <= 0) {
    throw new PaidCallDeniedError("budget_exhausted", "An explicit positive provider budget and estimate are required.");
  }
  const day = new Date().toISOString().slice(0, 10);
  const reservationRef = crypto.randomUUID();
  let db: ReturnType<typeof getDb>;
  try { db = getDb(); }
  catch { throw new PaidCallDeniedError("access_pending", "Provider budget database access is pending."); }
  let reserved: boolean;
  try {
    reserved = rowsOf(await db.execute(sql`
      insert into provider_budget_day (day, spent_usd, cap_usd, reservation_ref)
      select ${day}::date, ${estimate.toFixed(6)}::numeric, ${cap.toFixed(6)}::numeric, ${reservationRef}
      where ${estimate.toFixed(6)}::numeric <= ${cap.toFixed(6)}::numeric
      on conflict (day) do update
        set spent_usd = provider_budget_day.spent_usd + excluded.spent_usd,
            cap_usd = excluded.cap_usd, reservation_ref = excluded.reservation_ref
        where provider_budget_day.reservation_ref is null
          and provider_budget_day.spent_usd + excluded.spent_usd <= excluded.cap_usd
      returning day
    `)).length > 0;
  } catch {
    throw new PaidCallDeniedError("budget_exhausted", "Provider budget could not be reserved.");
  }
  if (!reserved) throw new PaidCallDeniedError("budget_exhausted", "Daily provider budget exhausted or another reservation needs reconciliation.");
  const record = (cost: number, ok: boolean) => recordCost({
    ...meta.context, provider: meta.provider, action: meta.action,
    units: 1, unitCostUsd: cost, ok, chargedOnFailure: !ok,
    requestRef: reservationRef,
  });
  // ponytail: serialize paid calls per UTC day; a durable token blocks unsafe spending after settlement failures.
  const settle = async (cost: number) => {
    try {
      const settled = rowsOf(await db.execute(sql`update provider_budget_day
        set spent_usd = greatest(0, spent_usd + ${(roundUsd(cost) - estimate).toFixed(6)}::numeric), reservation_ref = null
        where day = ${day}::date and reservation_ref = ${reservationRef}
        returning day`));
      if (settled.length !== 1) throw new Error("Provider reservation was not settled.");
    } catch { throw new PaidCallDeniedError("budget_exhausted", "Provider cost reconciliation is pending; further paid calls are blocked."); }
  };
  let result: PaidResult<T>;
  let started = false;
  try {
    meta.signal?.throwIfAborted();
    started = true;
    result = await work();
  } catch (error) {
    if (started && !(await record(estimate, false))) throw new PaidCallDeniedError("access_pending", "Provider cost recording is pending; further paid calls are blocked.");
    await settle(started ? estimate : 0);
    throw error;
  }
  const cost = result.costUsd ?? estimate;
  if (!Number.isFinite(cost) || cost < 0) {
    if (!(await record(estimate, false))) throw new PaidCallDeniedError("access_pending", "Provider cost recording is pending; further paid calls are blocked.");
    await settle(estimate);
    throw new Error("Provider returned invalid cost.");
  }
  if (!(await record(cost, result.error === undefined))) throw new PaidCallDeniedError("access_pending", "Provider cost recording is pending; further paid calls are blocked.");
  await settle(cost);
  if (result.error !== undefined) throw result.error;
  return result.value;
}
