import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { rowsOf } from "@/lib/db/rows";
import { recordCost, roundUsd } from "@/lib/costs/ledger";
import type { CostContext } from "@/lib/costs/meter";
import { reserveScanSpend } from "@/lib/activation/budget";

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

/**
 * VANTAGE_PAID_DAILY_BUDGET_<PROVIDER>_USD when it is a positive number (provider upper-cased,
 * non-alphanumerics to `_`), else the global VANTAGE_PAID_DAILY_BUDGET_USD. Read on every call.
 */
function providerCapUsd(provider: string): number {
  const key = provider.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const own = Number(process.env[`VANTAGE_PAID_DAILY_BUDGET_${key}_USD`]);
  if (Number.isFinite(own) && own > 0) return own;
  return Number(process.env.VANTAGE_PAID_DAILY_BUDGET_USD);
}

/**
 * One reservation and ledger row per outbound paid attempt; ambiguous failures stay charged.
 *
 * Budgets are per provider and per UTC day, and concurrent: reserve and settle are each one atomic
 * statement on provider_budget_reservation keyed (day, provider). Calls to other providers never wait
 * on this one, and overlapping calls to the same provider all run while their total fits the cap.
 * Settlement is best effort. If it fails, the estimate stays counted, which only over-counts spend.
 */
export async function runPaidCall<T>(meta: {
  context: CostContext; provider: string; action: string; estimateUsd: number; signal?: AbortSignal;
  /** A caller's own daily cap. The reservation uses the lower of it and the provider cap, in the same atomic statement. */
  capUsd?: number;
}, work: () => Promise<PaidResult<T>>): Promise<T> {
  meta.signal?.throwIfAborted();
  if (process.env.VANTAGE_PAID_PROVIDERS_ENABLED !== "true") {
    throw new PaidCallDeniedError("provider_disabled", "Paid providers are disabled.");
  }
  if (!meta.context.workspaceId) throw new PaidCallDeniedError("access_pending", "Paid calls require workspace attribution.");
  const cap = meta.capUsd === undefined ? providerCapUsd(meta.provider) : Math.min(providerCapUsd(meta.provider), meta.capUsd);
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
      insert into provider_budget_reservation (day, provider, spent_usd, cap_usd)
      select ${day}::date, ${meta.provider}::text, ${estimate.toFixed(6)}::numeric, ${cap.toFixed(6)}::numeric
      where ${estimate.toFixed(6)}::numeric <= ${cap.toFixed(6)}::numeric
      on conflict (day, provider) do update
        set spent_usd = provider_budget_reservation.spent_usd + excluded.spent_usd,
            cap_usd = excluded.cap_usd
      where provider_budget_reservation.spent_usd + excluded.spent_usd <= excluded.cap_usd
      returning day
    `)).length > 0;
  } catch {
    throw new PaidCallDeniedError("budget_exhausted", "Provider budget could not be reserved.");
  }
  if (!reserved) throw new PaidCallDeniedError("budget_exhausted", "Daily provider budget exhausted.");
  let scanSpend: Awaited<ReturnType<typeof reserveScanSpend>>;
  try {
    scanSpend = await reserveScanSpend(meta.context.workspaceId, meta.provider, meta.action, estimate);
  } catch {
    await db.execute(sql`update provider_budget_reservation set spent_usd = greatest(0, spent_usd - ${estimate.toFixed(6)}::numeric)
      where day = ${day}::date and provider = ${meta.provider}::text`);
    throw new PaidCallDeniedError("budget_exhausted", "First scan allowance unavailable.");
  }
  const record = (cost: number, ok: boolean) => recordCost({
    ...meta.context, provider: meta.provider, action: meta.action,
    units: 1, unitCostUsd: cost, ok, chargedOnFailure: !ok,
    requestRef: reservationRef,
  });
  const settle = async (cost: number) => {
    await scanSpend?.settle(cost);
    try {
      const delta = (roundUsd(cost) - estimate).toFixed(6);
      await db.execute(sql`update provider_budget_reservation
        set spent_usd = greatest(0, spent_usd + ${delta}::numeric)
        where day = ${day}::date and provider = ${meta.provider}::text`);
    } catch (err) {
      console.error("[paid] settle failed", { provider: meta.provider, error: err instanceof Error ? err.name : "unknown" });
    }
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
