import { eq, inArray, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { planLimit, workspace, workspaceUsage } from "@/lib/db/schema";
import {
  DEFAULT_LIMITS,
  LIMIT_KEYS,
  PLAN_IDS,
  PlanLimitError,
  type ConsumeResult,
  type LimitCheck,
  type LimitKey,
  type Limits,
  type MeteredKey,
  type PlanId,
} from "@/lib/plans/types";

/** Metered key -> usage column and window. Column names are a fixed whitelist (never user input). */
const METERED: Record<MeteredKey, { column: "scored_leads" | "deep_searches"; field: "scoredLeads" | "deepSearches"; window: "day" | "month" }> = {
  scored_leads_per_day: { column: "scored_leads", field: "scoredLeads", window: "day" },
  deep_searches_per_month: { column: "deep_searches", field: "deepSearches", window: "month" },
};

export function isMeteredKey(key: LimitKey): key is MeteredKey {
  return key in METERED;
}

export function normalizePlan(plan: unknown): PlanId {
  return (PLAN_IDS as readonly string[]).includes(String(plan)) ? (plan as PlanId) : "free";
}

/** UTC usage period: the day for per-day counters, the first of the month for per-month counters. */
export function usagePeriod(key: MeteredKey, now: Date = new Date()): string {
  const iso = now.toISOString();
  return METERED[key].window === "day" ? iso.slice(0, 10) : `${iso.slice(0, 7)}-01`;
}

export function evaluateLimit(limit: number, used: number, requested = 1): LimitCheck {
  const safeLimit = Math.max(0, Math.floor(limit));
  const safeUsed = Math.max(0, Math.floor(used));
  return {
    allowed: safeUsed + requested <= safeLimit,
    limit: safeLimit,
    used: safeUsed,
    remaining: Math.max(0, safeLimit - safeUsed),
  };
}

const SCAN_SLACK_MS = 10 * 60_000;

/** A scan is due when the last poll is older than the plan interval (minus cron jitter). */
export function isScanDue(lastPolledAt: Date | null | undefined, now: Date, intervalHours: number): boolean {
  if (!lastPolledAt || !Number.isFinite(lastPolledAt.getTime())) return true;
  return now.getTime() - lastPolledAt.getTime() >= intervalHours * 3_600_000 - SCAN_SLACK_MS;
}

/** Merge database rows over code defaults: defaults, then `free` rows, then the plan's rows. */
export function mergeLimits(plan: PlanId, rows: Array<{ plan: string; key: string; value: number }>): Limits {
  const merged: Limits = { ...DEFAULT_LIMITS.free, ...DEFAULT_LIMITS[plan] };
  const known = new Set<string>(LIMIT_KEYS);
  for (const owner of ["free", plan]) {
    for (const row of rows) {
      if (row.plan === owner && known.has(row.key) && Number.isFinite(row.value)) {
        merged[row.key as LimitKey] = row.value;
      }
    }
  }
  return merged;
}

export async function getLimits(plan: string): Promise<Limits> {
  const normalized = normalizePlan(plan);
  const rows = await getDb()
    .select()
    .from(planLimit)
    .where(inArray(planLimit.plan, ["free", normalized]));
  return mergeLimits(normalized, Array.isArray(rows) ? rows : []);
}

export async function getWorkspacePlan(workspaceId: string): Promise<PlanId> {
  const rows = await getDb()
    .select({ plan: workspace.plan })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  return normalizePlan(Array.isArray(rows) ? rows[0]?.plan : undefined);
}

async function readUsage(workspaceId: string, key: MeteredKey, now: Date): Promise<number> {
  const meta = METERED[key];
  const rows = await getDb()
    .select({ value: workspaceUsage[meta.field] })
    .from(workspaceUsage)
    .where(sql`${workspaceUsage.workspaceId} = ${workspaceId} and ${workspaceUsage.period} = ${usagePeriod(key, now)}`)
    .limit(1);
  return Array.isArray(rows) ? Number(rows[0]?.value ?? 0) : 0;
}

/** Read-only: how much of a metered limit is used. Does not consume. */
export async function checkLimit(workspaceId: string, key: MeteredKey, now: Date = new Date()): Promise<LimitCheck> {
  const plan = await getWorkspacePlan(workspaceId);
  const limits = await getLimits(plan);
  return evaluateLimit(limits[key], await readUsage(workspaceId, key, now));
}

/** Pure count check for static limits (projects, keywords, sources). */
export function checkCountLimit(limit: number, current: number, adding = 1): LimitCheck {
  return evaluateLimit(limit, current, adding);
}

/**
 * Atomically consume `n` units of a metered limit. neon-http has no interactive
 * transactions, so this is ONE statement: an upsert whose WHERE guard refuses to
 * push the counter past the plan limit (the limit is read inside the same statement,
 * so concurrent callers cannot both squeeze under it and SQL edits apply at once).
 * Returns `allowed: false` and consumes nothing when the request would exceed the limit.
 */
export async function consume(
  workspaceId: string,
  key: MeteredKey,
  n = 1,
  now: Date = new Date(),
): Promise<ConsumeResult> {
  if (!Number.isInteger(n) || n < 1) throw new Error("consume amount must be a positive integer");
  const meta = METERED[key];
  // sql.raw below takes its column name only from the fixed METERED map.
  if (!meta) throw new Error(`Unknown metered key: ${String(key)}`);
  const col = sql.raw(`"${meta.column}"`);
  const qualified = sql.raw(`"workspace_usage"."${meta.column}"`);
  const period = usagePeriod(key, now);
  const fallback = DEFAULT_LIMITS.free[key];
  const limitExpr = sql`coalesce(
    (select "value" from "plan_limit" where "plan" = (select "plan" from "workspace" where "id" = ${workspaceId}::uuid) and "key" = ${key}),
    (select "value" from "plan_limit" where "plan" = 'free' and "key" = ${key}),
    ${fallback}::int)`;

  const result = await getDb().execute(sql`
    insert into "workspace_usage" ("workspace_id", "period", ${col})
    select ${workspaceId}::uuid, ${period}::date, ${n}::int
    where ${n}::int <= ${limitExpr}
    on conflict ("workspace_id", "period") do update
      set ${col} = ${qualified} + ${n}::int, "updated_at" = now()
      where ${qualified} + ${n}::int <= ${limitExpr}
    returning ${col} as "used", ${limitExpr} as "limit"`);
  const rows = (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []) as Array<{ used: number | string; limit: number | string }>;
  if (rows[0]) {
    return { ...evaluateLimit(Number(rows[0].limit), Number(rows[0].used), 0), allowed: true, consumed: n };
  }
  const current = await checkLimit(workspaceId, key, now);
  return { ...current, allowed: false, consumed: 0 };
}

/**
 * Gives back units taken by `consume()` when the work they paid for did not happen.
 * Never drops usage below zero. Failures are logged, not thrown, so cleanup cannot mask the original error.
 */
export async function release(
  workspaceId: string,
  key: MeteredKey,
  n = 1,
  now: Date = new Date(),
): Promise<void> {
  const meta = METERED[key];
  if (!meta) throw new Error(`Unknown metered key: ${String(key)}`);
  const col = sql.raw(`"${meta.column}"`);
  try {
    await getDb().execute(sql`
      update "workspace_usage"
      set ${col} = greatest(${col} - ${n}::int, 0), "updated_at" = now()
      where "workspace_id" = ${workspaceId}::uuid and "period" = ${usagePeriod(key, now)}::date`);
  } catch (err) {
    console.error("[plans/limits] release failed", { key, error: err instanceof Error ? err.message : String(err) });
  }
}

const LIMIT_LABELS: Record<LimitKey, string> = {
  projects: "projects",
  keywords: "keywords",
  sources: "sources",
  scored_leads_per_day: "scored leads per day",
  deep_searches_per_month: "deep searches per month",
  discovery_reports: "discovery reports",
  reply_briefs: "Reply Briefs",
  alerts_3h: "3-hourly alerts",
  scan_interval_hours: "scan interval",
};

export function limitMessage(plan: PlanId, key: LimitKey, limit: number): string {
  const name = plan === "pro" ? "Pro" : "Free";
  if (limit === 0) return `Your ${name} plan does not include ${LIMIT_LABELS[key]}. Upgrade to use it.`;
  return `Your ${name} plan allows ${limit} ${LIMIT_LABELS[key]}. Upgrade for more.`;
}

/** Throws a PlanLimitError (a clear message, never a 500) if `current + adding` exceeds the plan limit. */
export async function assertWithinCount(
  workspaceId: string,
  key: "keywords" | "sources",
  current: number,
  adding = 1,
  /** Existing over-limit data is grandfathered: the total may stay at this count but not grow past it. */
  grandfathered = 0,
): Promise<void> {
  const plan = await getWorkspacePlan(workspaceId);
  const limit = (await getLimits(plan))[key];
  if (current + adding > grandfathered && !checkCountLimit(limit, current, adding).allowed) {
    throw new PlanLimitError(key, limit, limitMessage(plan, key, limit));
  }
}

/** A user may own up to the highest `projects` limit among their workspaces' plans. */
export async function assertCanCreateProject(ownerUserId: string): Promise<void> {
  const owned = await getDb().select({ plan: workspace.plan }).from(workspace).where(eq(workspace.ownerUserId, ownerUserId));
  const rows = Array.isArray(owned) ? owned : [];
  const plans = rows.length ? rows.map((row) => normalizePlan(row.plan)) : (["free"] as PlanId[]);
  let best = 0;
  let bestPlan: PlanId = "free";
  for (const plan of new Set(plans)) {
    const limit = (await getLimits(plan)).projects;
    if (limit >= best) { best = limit; bestPlan = plan; }
  }
  if (!checkCountLimit(best, rows.length).allowed) {
    throw new PlanLimitError("projects", best, limitMessage(bestPlan, "projects", best));
  }
}

export type PlanUsageView = {
  plan: PlanId;
  limits: Limits;
  usage: Array<{ key: LimitKey; label: string; used: number | null; limit: number }>;
};

/** Everything the Settings "Plan & usage" panel needs. */
export async function getPlanUsage(workspaceId: string, counts: { keywords: number; sources: number; projects: number }, now: Date = new Date()): Promise<PlanUsageView> {
  const plan = await getWorkspacePlan(workspaceId);
  const limits = await getLimits(plan);
  const scored = await readUsage(workspaceId, "scored_leads_per_day", now);
  const deep = await readUsage(workspaceId, "deep_searches_per_month", now);
  const used: Partial<Record<LimitKey, number>> = {
    projects: counts.projects,
    keywords: counts.keywords,
    sources: counts.sources,
    scored_leads_per_day: scored,
    deep_searches_per_month: deep,
  };
  return {
    plan,
    limits,
    usage: LIMIT_KEYS.filter((key) => key in used).map((key) => ({ key, label: LIMIT_LABELS[key], used: used[key] ?? null, limit: limits[key] })),
  };
}

export function featureEnabled(limits: Limits, key: "reply_briefs" | "alerts_3h"): boolean {
  return limits[key] > 0;
}
