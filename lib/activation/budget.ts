import { AsyncLocalStorage } from "node:async_hooks";
import { and, eq, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { scanRun } from "@/lib/db/schema";

export const FIRST_SCAN_BUDGET_USD = 0.10;
export const FIRST_SCAN_HYDRATION_MAX = 5;
const context = new AsyncLocalStorage<{ workspaceId: string; runId: string }>();

export class FirstScanAllowanceError extends Error {
  readonly code = "FIRST_SCAN_ALLOWANCE_EXHAUSTED";

  constructor() {
    super("First scan allowance exhausted");
    this.name = "FirstScanAllowanceError";
  }
}

export function withFirstScanBudget<T>(workspaceId: string, runId: string, work: () => Promise<T>): Promise<T> {
  return context.run({ workspaceId, runId }, work);
}

export async function reserveScanSpend(workspaceId: string, provider: string, action: string, estimate: number): Promise<null | { settle: (cost: number) => Promise<void> }> {
  const run = context.getStore();
  if (!run) return null;
  const db = getDb();
  const scope = and(eq(scanRun.workspaceId, run.workspaceId), eq(scanRun.id, run.runId), eq(scanRun.status, "running"));
  const hydration = provider === "scavio" && action === "reddit_hydrate";
  const allowed = workspaceId === run.workspaceId && (hydration || (provider === "firecrawl" && action === "search"));
  const [reserved] = allowed ? await db.update(scanRun).set({
    reservedUsd: sql`${scanRun.reservedUsd} + ${estimate.toFixed(6)}::numeric`,
    costUsd: sql`${scanRun.costUsd} + ${estimate.toFixed(6)}::numeric`,
    hydrationAttempts: sql`${scanRun.hydrationAttempts} + ${hydration ? 1 : 0}`,
  }).where(and(scope,
    sql`${scanRun.reservedUsd} + ${estimate.toFixed(6)}::numeric <= ${FIRST_SCAN_BUDGET_USD}`,
    hydration ? sql`${scanRun.hydrationAttempts} < ${FIRST_SCAN_HYDRATION_MAX}` : undefined,
  )).returning({ id: scanRun.id }) : [];
  if (!reserved) {
    await db.update(scanRun).set({ capped: true }).where(scope);
    throw new FirstScanAllowanceError();
  }
  return {
    settle: async (cost) => {
      await db.update(scanRun).set({ costUsd: sql`greatest(0, ${scanRun.costUsd} + ${(cost - estimate).toFixed(6)}::numeric)` }).where(scope);
    },
  };
}
