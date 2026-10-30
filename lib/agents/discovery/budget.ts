import { roundUsd } from "@/lib/costs/ledger";
import { dbBudgetStore, periodFor, utcDayStart } from "@/lib/agents/discovery/store";
import { PaidCallDeniedError } from "@/lib/providers/paid-call";

/*
 * Per-workspace spend caps for agent discovery. runPaidCall's own cap is per provider and per day across every
 * workspace, so this adds the per-workspace limit. Runs reserve their share atomically in the discovery_budget table (reservation.ts) and settle the
 * real cost afterwards; this file holds the caps and a read-only view of what is left. Every discovery call also passes
 * a `sourceKey` below, so the cost ledger can still be broken down by workspace.
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

/** A cap from the environment. Zero is a real cap (it switches discovery off); unset, negative or unreadable values use the default. */
function cap(raw: string | undefined, fallback: number): number {
  const value = Number(raw?.trim());
  return raw?.trim() && Number.isFinite(value) && value >= 0 ? value : fallback;
}

export const discoveryBudgetUsd = (env: Env = process.env) => cap(env.DISCOVERY_BUDGET_USD, DEFAULT_INITIAL_BUDGET_USD);
export const reviewDailyBudgetUsd = (env: Env = process.env) => cap(env.DISCOVERY_REVIEW_BUDGET_USD, DEFAULT_REVIEW_DAILY_BUDGET_USD);
export const sourceKeyFor = (kind: DiscoveryKind) => (kind === "initial" ? DISCOVERY_SOURCE_KEY : REVIEW_SOURCE_KEY);

export { utcDayStart };

export type SpentReader = (workspaceId: string, sourceKey: string, since?: Date) => Promise<number>;

type BudgetDeps = { readSpent?: SpentReader; env?: Env; now?: Date };

/** USD left under the cap, never below zero. */
export async function remainingDiscoveryBudgetUsd(workspaceId: string, kind: DiscoveryKind, deps: BudgetDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const cap = kind === "initial" ? discoveryBudgetUsd(env) : reviewDailyBudgetUsd(env);
  const now = deps.now ?? new Date();
  const since = kind === "review" ? utcDayStart(now) : undefined;
  const spent = deps.readSpent
    ? await deps.readSpent(workspaceId, sourceKeyFor(kind), since)
    : await dbBudgetStore.committed(workspaceId, periodFor(kind, now));
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
