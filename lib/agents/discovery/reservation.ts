import { discoveryBudgetUsd, reviewDailyBudgetUsd, type DiscoveryKind } from "@/lib/agents/discovery/budget";
import { dbBudgetStore, periodFor, type BudgetStore } from "@/lib/agents/discovery/store";
import { roundUsd } from "@/lib/costs/ledger";
import { PaidCallDeniedError } from "@/lib/providers/paid-call";

type Env = Record<string, string | undefined>;

/*
 * Atomic per-workspace discovery budget. Reading the ledger and then running is a race: two simultaneous requests both
 * read the same remaining figure and both go. Here a run first RESERVES its share in Neon with one conditional upsert
 * (the cap check and the add happen in the same statement, so a rival request cannot slip between them), spends
 * inside that reservation, and afterwards settles the real cost, returning what it did not use. If settling fails the
 * reservation stays counted, which only ever over-counts spend.
 */

/** The most one run may reserve, so a workspace's initial $0.50 allows at least two runs. */
export const MAX_RUN_USD = 0.25;
/** The least a run can usefully do. With less than this left, the run is denied before the model is called. */
export const MIN_RUN_USD = 0.02;
const RESERVE_ATTEMPTS = 3;

export type DiscoveryReservation = {
  /** USD this run may spend. */
  reservedUsd: number;
  /** Replaces the reservation with the real spend. Never throws. */
  settle: (actualUsd: number) => Promise<void>;
};

export async function reserveDiscoveryBudget(
  workspaceId: string,
  kind: DiscoveryKind,
  deps: { store?: BudgetStore; env?: Env; now?: Date } = {},
): Promise<DiscoveryReservation> {
  const store = deps.store ?? dbBudgetStore;
  const env = deps.env ?? process.env;
  const cap = kind === "initial" ? discoveryBudgetUsd(env) : reviewDailyBudgetUsd(env);
  const period = periodFor(kind, deps.now ?? new Date());
  const used = kind === "initial" ? "This workspace's discovery budget is used up." : "Today's review budget for this workspace is used up.";

  try {
    for (let attempt = 0; attempt < RESERVE_ATTEMPTS; attempt++) {
      const amount = roundUsd(Math.min(MAX_RUN_USD, cap - (await store.committed(workspaceId, period))));
      if (amount < Math.min(MIN_RUN_USD, cap)) throw new PaidCallDeniedError("budget_exhausted", used);
      // A rival request may take the budget between the read and this statement; then the upsert changes nothing and we re-read.
      if (await store.reserve(workspaceId, period, amount, cap)) {
        return {
          reservedUsd: amount,
          settle: async (actualUsd) => {
            try { await store.settle(workspaceId, period, amount, roundUsd(actualUsd)); }
            catch { console.error("[discovery] budget settle failed; the reservation stays counted"); }
          },
        };
      }
    }
  } catch (error) {
    if (error instanceof PaidCallDeniedError) throw error;
    throw new PaidCallDeniedError("budget_exhausted", "Discovery budget could not be reserved.");
  }
  throw new PaidCallDeniedError("budget_exhausted", used);
}
