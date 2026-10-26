export const PLAN_IDS = ["free", "pro"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export const LIMIT_KEYS = [
  "projects",
  "keywords",
  "sources",
  "scored_leads_per_day",
  "deep_searches_per_month",
  "discovery_reports",
  "discovery_initial_cents",
  "discovery_daily_review_cents",
  "reply_briefs",
  "alerts_3h",
  "scan_interval_hours",
  "seo_credits_per_month",
  "seo_questions_per_month",
] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];

export type Limits = Record<LimitKey, number>;

/** Limit keys that are tracked in `workspace_usage` and consumed atomically. */
export const METERED_KEYS = [
  "scored_leads_per_day",
  "deep_searches_per_month",
  "seo_credits_per_month",
  "seo_questions_per_month",
] as const;
export type MeteredKey = (typeof METERED_KEYS)[number];

/**
 * Fallback values used only when `plan_limit` has no row for a plan and key (and no
 * `free` row either). The database is the source of truth; `test/plans.test.ts`
 * asserts this table matches the seed in the migration.
 */
export const DEFAULT_LIMITS: Record<PlanId, Limits> = {
  free: {
    projects: 1,
    keywords: 5,
    sources: 8,
    scored_leads_per_day: 20,
    deep_searches_per_month: 0,
    discovery_reports: 1,
    discovery_initial_cents: 50,
    discovery_daily_review_cents: 5,
    reply_briefs: 0,
    alerts_3h: 0,
    scan_interval_hours: 24,
    seo_credits_per_month: 6,
    seo_questions_per_month: 10,
  },
  pro: {
    projects: 3,
    keywords: 25,
    sources: 25,
    scored_leads_per_day: 100,
    deep_searches_per_month: 5,
    discovery_reports: 1,
    discovery_initial_cents: 50,
    discovery_daily_review_cents: 5,
    reply_briefs: 1,
    alerts_3h: 1,
    scan_interval_hours: 3,
    seo_credits_per_month: 60,
    seo_questions_per_month: 150,
  },
};

export type LimitCheck = {
  allowed: boolean;
  limit: number;
  used: number;
  remaining: number;
};

export type ConsumeResult = LimitCheck & { consumed: number };

export class PlanLimitError extends Error {
  readonly code = "plan_limit_exceeded";
  constructor(
    readonly key: LimitKey,
    readonly limit: number,
    message: string,
  ) {
    super(message);
    this.name = "PlanLimitError";
  }
}
