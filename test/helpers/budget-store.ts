import type { BudgetStore } from "@/lib/agents/discovery";

/*
 * An in-memory stand-in for the discovery_budget table. `reserve` is atomic, like the single conditional upsert in
 * Neon: check and add happen with no await between them. Every method yields first, so concurrent callers interleave
 * the way two Worker requests would: both can read the same stale figure before either reserves.
 */
export function memoryBudgetStore(initial: Record<string, number> = {}) {
  const rows = new Map<string, number>(Object.entries(initial));
  const key = (workspaceId: string, period: string) => `${workspaceId}|${period}`;
  const yieldTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  const store: BudgetStore = {
    async committed(workspaceId, period) { await yieldTurn(); return rows.get(key(workspaceId, period)) ?? 0; },
    async reserve(workspaceId, period, usd, capUsd) {
      await yieldTurn();
      const current = rows.get(key(workspaceId, period)) ?? 0;
      if (current + usd > capUsd + 1e-9) return false;
      rows.set(key(workspaceId, period), current + usd);
      return true;
    },
    async settle(workspaceId, period, reservedUsd, actualUsd) {
      await yieldTurn();
      rows.set(key(workspaceId, period), Math.max(0, (rows.get(key(workspaceId, period)) ?? 0) + actualUsd - reservedUsd));
    },
  };
  return { store, rows, get: (workspaceId: string, period: string) => rows.get(key(workspaceId, period)) ?? 0 };
}
