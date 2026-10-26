import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { rowsOf } from "@/lib/db/rows";
import { roundUsd } from "@/lib/costs/ledger";
import type { DiscoveryScope } from "./types";

type BudgetContext = { workspaceId: string; scope: DiscoveryScope; requestId: string };
type ActiveBudgetContext = BudgetContext & { nextAttempt: number; blocked: boolean; runToken: string };
const context = new AsyncLocalStorage<ActiveBudgetContext>();

export class DiscoveryBudgetError extends Error {
  constructor(message = "Discovery workspace budget unavailable.") {
    super(message);
    this.name = "DiscoveryBudgetError";
  }
}

function databaseError(error: unknown, known: readonly string[]): DiscoveryBudgetError {
  const cause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;
  const pg = cause && typeof cause === "object" ? cause as { code?: unknown; message?: unknown } : null;
  const message = pg?.code === "P0001" && typeof pg.message === "string" && known.includes(pg.message)
    ? pg.message : "Discovery workspace budget unavailable.";
  return new DiscoveryBudgetError(message);
}

function dollars(value: number, positive: boolean): string {
  if (!Number.isFinite(value) || value < 0 || (positive && value === 0)) {
    throw new RangeError("Discovery amount must be finite and nonnegative.");
  }
  const rounded = roundUsd(value);
  if (positive && rounded <= 0) throw new RangeError("Discovery estimate is below accounting precision.");
  return rounded.toFixed(6);
}

/** The caller must enclose the actual paid model stream and tool attempts in this context. */
export function withDiscoveryBudget<T>(input: BudgetContext, work: () => Promise<T>): Promise<T> {
  if (!input.workspaceId || !input.requestId || input.requestId.length > 160 || !["initial", "daily_review"].includes(input.scope)) {
    throw new TypeError("Invalid discovery context.");
  }
  return context.run({ ...input, nextAttempt: 0, blocked: false, runToken: crypto.randomUUID() }, work);
}

export function discoveryBudgetContext(): BudgetContext | undefined { return context.getStore(); }
export function markDiscoveryBudgetUnreconciled(): void {
  const run = context.getStore();
  if (run) run.blocked = true;
}

async function reserve(input: BudgetContext & { estimateUsd: number; runToken?: string }): Promise<{ reservationId: string; created: boolean }> {
  const estimate = dollars(input.estimateUsd, true);
  const id = crypto.randomUUID();
  let row: { id?: unknown; created?: unknown } | undefined;
  try {
    row = rowsOf(await getDb().execute(sql`
      select reservation_id as id, created from reserve_discovery_spend(${id}::uuid, ${input.workspaceId}::uuid, ${input.scope}::text,
        ${input.requestId}::text, ${estimate}::numeric, ${input.runToken ?? crypto.randomUUID()}::uuid)
    `))[0] as { id?: unknown; created?: unknown } | undefined;
  } catch (error) {
    throw databaseError(error, ["Conflicting discovery request ID", "Discovery spend needs reconciliation"]);
  }
  if (typeof row?.id !== "string" || typeof row.created !== "boolean") throw new DiscoveryBudgetError();
  return { reservationId: row.id, created: row.created };
}

export async function reserveDiscoverySpend(input: BudgetContext & { estimateUsd: number }): Promise<{ reservationId: string }> {
  const { reservationId } = await reserve(input);
  return { reservationId };
}

export async function settleDiscoverySpend(input: { workspaceId: string; reservationId: string; actualUsd?: number; outcome: "success" | "failed" | "ambiguous" }): Promise<void> {
  const actual = input.actualUsd === undefined ? null : dollars(input.actualUsd, false);
  try {
    await getDb().execute(sql`select settle_discovery_spend(${input.workspaceId}::uuid, ${input.reservationId}::uuid,
      ${actual}::numeric, ${input.outcome}::text)`);
  } catch (error) {
    throw databaseError(error, ["Conflicting discovery settlement", "Discovery reservation not found"]);
  }
}

/** Each runPaidCall obtains a distinct durable receipt. The global provider ledger still meters once. */
export async function reserveDiscoveryAttempt(workspaceId: string, estimateUsd: number): Promise<null | { reservationId: string; settle: (actualUsd: number | undefined, outcome: "success" | "failed" | "ambiguous") => Promise<void> }> {
  const run = context.getStore();
  if (!run) return null;
  if (run.blocked) throw new DiscoveryBudgetError("Discovery spend needs reconciliation before another attempt.");
  if (workspaceId !== run.workspaceId) throw new DiscoveryBudgetError("Paid attempt crossed discovery workspace.");
  const attempt = ++run.nextAttempt;
  const { reservationId, created } = await reserve({ ...run, requestId: `${run.requestId}:${attempt}`, estimateUsd });
  if (!created) throw new DiscoveryBudgetError("Discovery attempt already reserved; replay requires its saved result.");
  return { reservationId, settle: (actualUsd, outcome) => settleDiscoverySpend({ workspaceId, reservationId, actualUsd, outcome }) };
}
