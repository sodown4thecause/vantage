import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { numericField, rowsOf } from "@/lib/db/rows";

/*
 * The discovery_budget table: USD reserved or spent per workspace and period. Reserving is one conditional upsert, so
 * the cap check and the add cannot be split by a rival request.
 */

export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export type BudgetStore = {
  /** USD already reserved or spent for this workspace and period. */
  committed(workspaceId: string, period: string): Promise<number>;
  /** Adds `usd` only if the total stays within `capUsd`, atomically. True when it was added. */
  reserve(workspaceId: string, period: string, usd: number, capUsd: number): Promise<boolean>;
  /** Replaces a reservation of `reservedUsd` with what was actually spent. */
  settle(workspaceId: string, period: string, reservedUsd: number, actualUsd: number): Promise<void>;
};

export const periodFor = (kind: "initial" | "review", now: Date) => (kind === "initial" ? "initial" : `day:${utcDayStart(now).toISOString().slice(0, 10)}`);
const fixed = (usd: number) => usd.toFixed(6);

export const dbBudgetStore: BudgetStore = {
  async committed(workspaceId, period) {
    const rows = rowsOf(await getDb().execute(sql`
      select committed_usd from discovery_budget where workspace_id = ${workspaceId}::uuid and period = ${period}::text
    `));
    return numericField(rows[0], "committed_usd") ?? 0;
  },

  async reserve(workspaceId, period, usd, capUsd) {
    return rowsOf(await getDb().execute(sql`
      insert into discovery_budget (workspace_id, period, committed_usd)
      select ${workspaceId}::uuid, ${period}::text, ${fixed(usd)}::numeric
      where ${fixed(usd)}::numeric <= ${fixed(capUsd)}::numeric
      on conflict (workspace_id, period) do update
        set committed_usd = discovery_budget.committed_usd + excluded.committed_usd, updated_at = now()
      where discovery_budget.committed_usd + excluded.committed_usd <= ${fixed(capUsd)}::numeric
      returning workspace_id
    `)).length > 0;
  },

  async settle(workspaceId, period, reservedUsd, actualUsd) {
    await getDb().execute(sql`
      update discovery_budget
      set committed_usd = greatest(0, committed_usd + ${fixed(actualUsd - reservedUsd)}::numeric), updated_at = now()
      where workspace_id = ${workspaceId}::uuid and period = ${period}::text
    `);
  },
};
