import type { SourceType } from "@/lib/collectors/types";

/**
 * THE FREE BASIC SCAN, DEFINED PRECISELY (login-first decision, 7 Oct 2026).
 *
 * The lead magnet is a basic scan inside a free, signed-in workspace. Anonymous
 * visitors get a static sample on the homepage, never a live scan. This file is
 * the single source of truth for the scan's bounds; both the server action and
 * the API route read these constants, and `docs/slices/S45-free-plan-guardrails.md`
 * documents the same numbers.
 *
 * Sources (FREE lane only; paid types are opt-in and never part of the free scan):
 *   hn, rss, substack. These are the only types the production guard in
 *   `lib/collectors/run.ts` permits, so the free scan cannot silently reach a
 *   paid provider.
 *
 * Bounds:
 *   - maxSourcesPerScan: 8 sources collected per scan (matches the scheduled scan).
 *   - maxDocuments: 50 most recent documents scored into opportunities.
 *   - perUserPerDay: 1 free basic scan per workspace per UTC day, enforced by an
 *     atomic DB upsert (`consumeFreeScan`).
 *   - dailyBudgetUsd: reuses the S06 `budget_day` global dollar guard so a burst
 *     of free accounts cannot blow the platform budget. Exhaustion returns a
 *     "queued for tomorrow" state, not an error.
 */
export const FREE_SCAN_SOURCE_TYPES = ["hn", "rss", "substack"] as const satisfies readonly SourceType[];

export type FreeScanSourceType = (typeof FREE_SCAN_SOURCE_TYPES)[number];

export const FREE_SCAN_LIMITS = {
  maxSourcesPerScan: 8,
  maxDocuments: 50,
  perUserPerDay: 1,
  dailyBudgetUsd: 1,
} as const;

/** A free scan costs at most this per run; used to reserve against the global daily budget. */
export const FREE_SCAN_ESTIMATE_USD = 0.05;

export function isFreeScanSourceType(type: string): type is FreeScanSourceType {
  return (FREE_SCAN_SOURCE_TYPES as readonly string[]).includes(type);
}

export const FREE_SCAN_LABEL = "Free basic scan";
