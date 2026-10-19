import { sql } from "drizzle-orm";

import { roundUsd } from "@/lib/costs/ledger";
import { getDb } from "@/lib/db/client";
import { numericField, rowsOf } from "@/lib/db/rows";
import { dataForSeoCacheKey, readDataForSeoCache, writeDataForSeoCache } from "@/lib/dataforseo/cache";
import { DataForSeoApiError, dataForSeoPost, getDataForSeoBalance } from "@/lib/dataforseo/client";
import { type DataForSeoConfig, usableDataForSeoConfig } from "@/lib/dataforseo/config";
import { consume, release } from "@/lib/plans/limits";
import { runPaidCall } from "@/lib/providers/paid-call";

export type DataForSeoDenial = "not_configured" | "credits_exhausted" | "reserve_floor" | "balance_unknown" | "daily_cap";

// Messages are fixed copy: the UI maps `code` to its own wording, and nothing here may carry balances or credentials.
const DENIAL_MESSAGES: Record<DataForSeoDenial, string> = {
  not_configured: "DataForSEO is not configured.",
  credits_exhausted: "No SEO credits are left this month.",
  reserve_floor: "The DataForSEO balance is below the reserve floor.",
  balance_unknown: "The DataForSEO balance could not be checked.",
  daily_cap: "The daily DataForSEO budget is used up.",
};

export class DataForSeoDeniedError extends Error {
  constructor(readonly code: DataForSeoDenial, message: string) {
    super(message);
    this.name = "DataForSeoDeniedError";
  }
}

const deny = (code: DataForSeoDenial) => new DataForSeoDeniedError(code, DENIAL_MESSAGES[code]);

export type GateRequest<R, T> = {
  workspaceId: string;
  endpoint: string;
  task: Record<string, unknown>;
  ttlSeconds: number;
  estimateUsd: number;
  trim: (result: R[]) => T;
};

type GateOptions = { signal?: AbortSignal; fetchImpl?: typeof fetch; now?: Date };

const CREDIT_KEY = "seo_credits_per_month";
const BALANCE_TTL_MS = 5 * 60_000;

// Module-level memo: a warm isolate reuses one balance for up to five minutes. Failed lookups are never stored.
let balanceMemo: { value: number; expiresAt: number } | null = null;

export function resetBalanceCacheForTests(): void {
  balanceMemo = null;
}

async function assertBalance(config: DataForSeoConfig, opts: GateOptions, now: Date): Promise<void> {
  let balance: number;
  if (balanceMemo && balanceMemo.expiresAt > now.getTime()) {
    balance = balanceMemo.value;
  } else {
    try {
      balance = await getDataForSeoBalance(config, { signal: opts.signal, fetchImpl: opts.fetchImpl });
    } catch {
      throw deny("balance_unknown");
    }
    balanceMemo = { value: balance, expiresAt: now.getTime() + BALANCE_TTL_MS };
  }
  if (balance < config.reserveFloorUsd) throw deny("reserve_floor");
  if (balance < config.alertBalanceUsd) {
    console.warn("[dataforseo] balance below alert threshold", { balance });
  }
}

/** Account-wide DataForSEO spend since UTC midnight. Throws when the total cannot be read, so the cap fails closed. */
export async function dataForSeoSpentTodayUsd(now: Date = new Date()): Promise<number> {
  const midnight = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const result = await getDb().execute(sql`
    select coalesce(sum(cost_usd), 0)::text as total
    from cost_event
    where provider = 'dataforseo' and ts >= ${midnight.toISOString()}::timestamptz`);
  const total = numericField(rowsOf(result)[0], "total");
  if (total === null) throw new Error("Unexpected DataForSEO spend result shape");
  return total;
}

async function assertDailyCap(config: DataForSeoConfig, estimateUsd: number, now: Date): Promise<void> {
  let spent: number;
  try {
    spent = await dataForSeoSpentTodayUsd(now);
  } catch {
    throw deny("daily_cap");
  }
  if (roundUsd(spent + estimateUsd) > config.dailyBudgetUsd) throw deny("daily_cap");
}

/**
 * Order (each step decides; the first refusal stops the call):
 *   1. config missing, or sandbox in production without ALLOW_FIXTURES -> not_configured
 *   2. cache hit -> return it (no credit, no fetch)
 *   3. consume one SEO credit; refused -> credits_exhausted
 *   4. from here, any throw releases that credit exactly once and rethrows
 *      5. live only: balance floor and alert threshold
 *      6. today's DataForSEO spend plus the estimate must fit the daily cap
 *      7. the paid call, through runPaidCall
 *   8. cache the trimmed value (a failed write never releases the credit)
 * runPaidCall charges its estimate for any throw that is not a DataForSeoApiError with a known cost.
 */
export async function runDataForSeo<R, T>(
  req: GateRequest<R, T>,
  opts: GateOptions = {},
): Promise<{ value: T; cached: boolean }> {
  const config = usableDataForSeoConfig();
  if (!config) throw deny("not_configured");

  const now = opts.now ?? new Date();
  const key = dataForSeoCacheKey(config.env, req.endpoint, req.task);
  const hit = await readDataForSeoCache<T>(key, now);
  if (hit !== null) return { value: hit, cached: true };

  const credit = await consume(req.workspaceId, CREDIT_KEY, 1, now);
  if (!credit.allowed) throw deny("credits_exhausted");

  let value: T;
  try {
    if (config.env === "live") await assertBalance(config, opts, now);
    await assertDailyCap(config, req.estimateUsd, now);
    value = await runPaidCall<T>({
      context: { workspaceId: req.workspaceId, sourceKey: "seo" },
      provider: "dataforseo",
      action: req.endpoint,
      estimateUsd: req.estimateUsd,
      signal: opts.signal,
    }, async () => {
      try {
        const { result, costUsd } = await dataForSeoPost<R>(config, req.endpoint, req.task, {
          signal: opts.signal,
          fetchImpl: opts.fetchImpl,
        });
        return { value: req.trim(result), costUsd };
      } catch (err) {
        // An unreadable cost stays undefined so runPaidCall charges the estimate instead of zero.
        if (err instanceof DataForSeoApiError) return { error: err, costUsd: err.costUsd };
        throw err;
      }
    });
  } catch (err) {
    await release(req.workspaceId, CREDIT_KEY, 1, now);
    throw err;
  }

  // The paid result is kept even if the cache write fails. writeDataForSeoCache is designed never to throw; this guards the contract.
  try {
    await writeDataForSeoCache(key, req.endpoint, value, req.ttlSeconds, now);
  } catch (err) {
    console.error("[dataforseo] cache write failed", { error: err instanceof Error ? err.name : "unknown" });
  }
  return { value, cached: false };
}

/** Cache-only read for the UI. Never consumes a credit, touches the budget or fetches. */
export async function peekDataForSeo<T>(endpoint: string, task: Record<string, unknown>): Promise<T | null> {
  const config = usableDataForSeoConfig();
  if (!config) return null;
  return readDataForSeoCache<T>(dataForSeoCacheKey(config.env, endpoint, task));
}
