import { and, eq, gte, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { costEvent } from "@/lib/db/schema";
import { roundUsd } from "@/lib/costs/ledger";
import { PaidCallDeniedError } from "@/lib/providers/paid-call";

/*
 * Per-workspace spend caps for agent discovery. runPaidCall's own cap is per provider and per day across every
 * workspace, so this adds the per-workspace limit. Spend is read from the cost ledger: every discovery call passes a
 * `sourceKey` below, so what the gateway and Linkup record for a workspace is exactly what counts against it.
 *
 *  - initial discovery: DISCOVERY_BUDGET_USD, default $0.50 per workspace, one time (all-time spend).
 *  - review loops: DISCOVERY_REVIEW_BUDGET_USD, default $0.05 per workspace per UTC day.
 */

export const DEFAULT_INITIAL_BUDGET_USD = 0.5;
export const DEFAULT_REVIEW_DAILY_BUDGET_USD = 0.05;
export const DISCOVERY_SOURCE_KEY = "discovery";
export const REVIEW_SOURCE_KEY = "discovery_review";

export type DiscoveryKind = "initial" | "review";
type Env = Record<string, string | undefined>;

function positive(raw: string | undefined, fallback: number): number {
  const value = Number(raw?.trim());
  return raw?.trim() && Number.isFinite(value) && value > 0 ? value : fallback;
}

export const discoveryBudgetUsd = (env: Env = process.env) => positive(env.DISCOVERY_BUDGET_USD, DEFAULT_INITIAL_BUDGET_USD);
export const reviewDailyBudgetUsd = (env: Env = process.env) => positive(env.DISCOVERY_REVIEW_BUDGET_USD, DEFAULT_REVIEW_DAILY_BUDGET_USD);
export const sourceKeyFor = (kind: DiscoveryKind) => (kind === "initial" ? DISCOVERY_SOURCE_KEY : REVIEW_SOURCE_KEY);

export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export type SpentReader = (workspaceId: string, sourceKey: string, since?: Date) => Promise<number>;

/** Total USD recorded in the cost ledger for one workspace and source key, optionally from `since` onwards. */
export const readSpentFromLedger: SpentReader = async (workspaceId, sourceKey, since) => {
  const [row] = await getDb().select({ total: sql<string>`coalesce(sum(${costEvent.costUsd}), 0)` }).from(costEvent)
    .where(and(eq(costEvent.workspaceId, workspaceId), eq(costEvent.sourceKey, sourceKey), ...(since ? [gte(costEvent.ts, since)] : [])));
  const total = Number(row?.total ?? 0);
  return Number.isFinite(total) ? total : 0;
};

type BudgetDeps = { readSpent?: SpentReader; env?: Env; now?: Date };

/** USD left under the cap, never below zero. */
export async function remainingDiscoveryBudgetUsd(workspaceId: string, kind: DiscoveryKind, deps: BudgetDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const cap = kind === "initial" ? discoveryBudgetUsd(env) : reviewDailyBudgetUsd(env);
  const since = kind === "review" ? utcDayStart(deps.now ?? new Date()) : undefined;
  const spent = await (deps.readSpent ?? readSpentFromLedger)(workspaceId, sourceKeyFor(kind), since);
  return roundUsd(Math.max(0, cap - spent));
}

/** Resolves with the USD remaining when it covers `estimateUsd`; otherwise denies the call like any other paid call. */
export async function assertDiscoveryBudget(workspaceId: string, kind: DiscoveryKind, estimateUsd: number, deps: BudgetDeps = {}): Promise<number> {
  let remaining: number;
  try { remaining = await remainingDiscoveryBudgetUsd(workspaceId, kind, deps); }
  catch { throw new PaidCallDeniedError("budget_exhausted", "Discovery budget could not be checked."); }
  if (remaining < estimateUsd) {
    throw new PaidCallDeniedError("budget_exhausted", kind === "initial" ? "This workspace's discovery budget is used up." : "Today's review budget for this workspace is used up.");
  }
  return remaining;
}
