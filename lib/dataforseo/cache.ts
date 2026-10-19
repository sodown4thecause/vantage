import { createHash } from "node:crypto";

import { and, desc, eq, gt } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { dataforseoCache, dataforseoSnapshot } from "@/lib/db/schema";
import type { DataForSeoEnv } from "@/lib/dataforseo/config";

/*
 * Deliberately global, not workspace-scoped: entries hold trimmed third-party public SEO data and are keyed only on
 * version, env, endpoint and normalized params (never a workspace or user id), so a shared hit reveals nothing private
 * and saves paid calls. Spend is still attributed per workspace in cost_event.
 * Callers must pass only public provider params (never workspace or user data).
 *
 * Snapshots are append-only and never deleted: every paid response is kept as a dated row, and a read takes the newest
 * row inside the caller's freshness window. Old rows are history, not garbage, so no code path removes snapshot rows.
 */

// Bump when a trim shape changes so stale entries are never read as the new shape.
export const CACHE_VERSION = "v1";

// How long a stored response still counts as fresh, per data kind.
export const FRESHNESS_SECONDS = {
  backlinks: 2_592_000,
  keywords: 2_592_000,
  aiKeywords: 2_592_000,
  serp: 604_800,
  llm: 604_800,
} as const;

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map(key => [key, canonical(record[key])]));
  }
  return value;
};

const stableJson = (value: unknown): string => JSON.stringify(canonical(value));

export function dataForSeoCacheKey(env: DataForSeoEnv, endpoint: string, params: Record<string, unknown>): string {
  return createHash("sha256").update(`${CACHE_VERSION}|${env}|${endpoint}|${stableJson(params)}`).digest("hex");
}

/*
 * Newest snapshot fetched within the window; otherwise a live row from the legacy table, so entries written before
 * snapshots existed still serve. Null on miss or any database error. The cache never blocks or decides a paid call.
 */
export async function readDataForSeoCache<T>(
  key: string,
  freshnessSeconds: number,
  now: Date = new Date(),
): Promise<T | null> {
  try {
    const since = new Date(now.getTime() - freshnessSeconds * 1000);
    const db = getDb();
    const fresh = await db
      .select({ responseJson: dataforseoSnapshot.responseJson })
      .from(dataforseoSnapshot)
      .where(and(eq(dataforseoSnapshot.cacheKey, key), gt(dataforseoSnapshot.fetchedAt, since)))
      .orderBy(desc(dataforseoSnapshot.fetchedAt))
      .limit(1);
    if (fresh[0]) return fresh[0].responseJson as T;

    const legacy = await db
      .select({ responseJson: dataforseoCache.responseJson })
      .from(dataforseoCache)
      .where(and(eq(dataforseoCache.cacheKey, key), gt(dataforseoCache.expiresAt, now)))
      .limit(1);
    return legacy[0] ? (legacy[0].responseJson as T) : null;
  } catch (err) {
    console.error("[dataforseo] cache read failed", { error: err instanceof Error ? err.name : "unknown" });
    return null;
  }
}

// Appends a snapshot; never updates or deletes. Errors are logged and swallowed; a failed write only costs a future refetch.
export async function writeDataForSeoCache(key: string, endpoint: string, value: unknown): Promise<void> {
  try {
    await getDb().insert(dataforseoSnapshot).values({ cacheKey: key, endpoint, responseJson: value });
  } catch (err) {
    console.error("[dataforseo] cache write failed", { error: err instanceof Error ? err.name : "unknown" });
  }
}
