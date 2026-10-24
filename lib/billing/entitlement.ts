import { sql, type SQL } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { rowsOf } from "@/lib/db/rows";

/**
 * Subscription statuses that keep paid access. A cancel at period end stays `active` until
 * Polar revokes it; `past_due` keeps access through Polar's payment retries, and the
 * `subscription.revoked` event (status `canceled`, `ended_at` set) ends it.
 */
export const PAID_STATUSES = ["active", "trialing", "past_due"] as const;

/** SQL: true when `userIdExpr` has a live subscription granting Pro. Pure SQL, no input interpolation. */
export function userIsPaidSql(userIdExpr: SQL): SQL<boolean> {
  return sql<boolean>`exists (
    select 1 from "billing_subscription" "bs"
    where "bs"."user_id" = ${userIdExpr}
      and "bs"."plan" = 'pro'
      and "bs"."status" in ('active', 'trialing', 'past_due')
      and ("bs"."ended_at" is null or "bs"."ended_at" > now())
  )`;
}

/** SQL: true when the workspace's owner has a subscription still inside its Polar trial. */
export function workspaceIsTrialingSql(workspaceIdExpr: SQL): SQL<boolean> {
  return sql<boolean>`exists (
    select 1 from "workspace" "wt"
    join "billing_subscription" "bst" on "bst"."user_id" = "wt"."owner_user_id"
    where "wt"."id" = ${workspaceIdExpr}
      and "bst"."status" = 'trialing'
      and ("bst"."ended_at" is null or "bst"."ended_at" > now())
  )`;
}

/**
 * SQL: the effective plan of one workspace. Pro when an operator granted it (`workspace.plan`)
 * or the workspace owner has a live Pro subscription; otherwise free.
 */
export function effectivePlanSql(workspaceId: string): SQL<string> {
  return sql<string>`(select case when "w"."plan" = 'pro' or ${userIsPaidSql(sql`"w"."owner_user_id"`)} then 'pro' else 'free' end
    from "workspace" "w" where "w"."id" = ${workspaceId}::uuid)`;
}

/** Server-side check of a user's paid access. Never trust client state for this. */
export async function userHasPaidPlan(userId: string): Promise<boolean> {
  if (!userId) return false;
  const result = await getDb().execute(sql`select ${userIsPaidSql(sql`${userId}`)} as "paid"`);
  const row = rowsOf(result)[0] as { paid?: unknown } | undefined;
  return row?.paid === true || row?.paid === "t";
}
