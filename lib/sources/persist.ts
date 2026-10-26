import { sql } from "drizzle-orm";
import { effectivePlanSql } from "@/lib/billing/entitlement";
import { getDb } from "@/lib/db/client";
import { rowsOf } from "@/lib/db/rows";
import type { NewSource } from "@/lib/db/schema";
import { countLimitSql, limitMessage } from "@/lib/plans/limits";
import { PlanLimitError, type PlanId } from "@/lib/plans/types";

export const PROFILE_SOURCE_NAME = "Profile: Hacker News";
export const reservedProfileSourceSlot = (workspaceId: string) => sql`case when exists (select 1 from source where workspace_id = ${workspaceId}::uuid and name = ${PROFILE_SOURCE_NAME}) then 0 else 1 end`;

/** Callers authorize and validate first. Count and write share the approval lock order; no upstream work occurs in this batch. */
export async function persistSourceWithinLimit(workspaceId: string, value: Pick<NewSource, "name" | "type" | "lane" | "config">, mergeConfig = false): Promise<boolean> {
  const db = getDb();
  const limit = countLimitSql(workspaceId, "sources");
  const conflict = mergeConfig ? sql`do update set config = source.config || excluded.config, updated_at = now()` : sql`do nothing`;
  const results = await db.batch([
    db.execute(sql`select set_config('lock_timeout', '1000ms', true), set_config('statement_timeout', '10000ms', true)`),
    db.execute(sql`lock table source in share row exclusive mode`),
    db.execute(sql`select id from workspace where id = ${workspaceId}::uuid for update`),
    db.execute(sql`with present as materialized (select id from source where workspace_id = ${workspaceId}::uuid and name = ${value.name}), written as (
      insert into source (workspace_id, name, type, lane, config)
      select ${workspaceId}::uuid, ${value.name}, ${value.type}::source_type, ${value.lane ?? "free"}::source_lane, ${JSON.stringify(value.config ?? {})}::jsonb
      where exists (select 1 from workspace where id = ${workspaceId}::uuid) and (exists (select 1 from present) or
        (select count(*) from source where workspace_id = ${workspaceId}::uuid) + 1 + case when ${value.name} = ${PROFILE_SOURCE_NAME} then 0 else ${reservedProfileSourceSlot(workspaceId)} end <= ${limit})
      on conflict (workspace_id, name) ${conflict} returning id
    ) select exists (select 1 from written) written, exists (select 1 from present) present, ${limit} as cap, ${effectivePlanSql(workspaceId)} as plan`),
  ]);
  const [row] = rowsOf(results.at(-1)) as { written: boolean; present: boolean; cap: number; plan: PlanId }[];
  if (!row) throw new Error("Source write failed");
  if (!row.written && !row.present) throw new PlanLimitError("sources", row.cap, limitMessage(row.plan, "sources", row.cap));
  return row.written;
}
