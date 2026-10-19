import { createHash } from "node:crypto";

import { and, eq, gt } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { dataforseoCache } from "@/lib/db/schema";
import type { DataForSeoEnv } from "@/lib/dataforseo/config";

/*
 * Deliberately global, not workspace-scoped: entries hold trimmed third-party public SEO data and are keyed only on
 * version, env, endpoint and normalized params (never a workspace or user id), so a shared hit reveals nothing private
 * and saves paid calls. Spend is still attributed per workspace in cost_event.
 * Callers must pass only public provider params (never workspace or user data).
 */

// Bump when a trim shape changes so stale entries are never read as the new shape.
export const CACHE_VERSION = "v1";

export const TTL_SECONDS = { backlinks: 604_800 } as const;

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

// Null on miss, expiry or any database error. The cache never blocks or decides a paid call.
export async function readDataForSeoCache<T>(key: string, now: Date = new Date()): Promise<T | null> {
  try {
    const rows = await getDb()
      .select({ responseJson: dataforseoCache.responseJson })
      .from(dataforseoCache)
      .where(and(eq(dataforseoCache.cacheKey, key), gt(dataforseoCache.expiresAt, now)))
      .limit(1);
    return rows[0] ? (rows[0].responseJson as T) : null;
  } catch (err) {
    console.error("[dataforseo] cache read failed", { error: err instanceof Error ? err.name : "unknown" });
    return null;
  }
}

// Upserts so a refetch replaces an expired row. Errors are logged and swallowed; a failed write only costs a future refetch.
export async function writeDataForSeoCache(
  key: string,
  endpoint: string,
  value: unknown,
  ttlSeconds: number,
  now: Date = new Date(),
): Promise<void> {
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
  try {
    await getDb()
      .insert(dataforseoCache)
      .values({ cacheKey: key, endpoint, responseJson: value, fetchedAt: now, expiresAt })
      .onConflictDoUpdate({
        target: dataforseoCache.cacheKey,
        set: { responseJson: value, fetchedAt: now, expiresAt },
      });
  } catch (err) {
    console.error("[dataforseo] cache write failed", { error: err instanceof Error ? err.name : "unknown" });
  }
}
