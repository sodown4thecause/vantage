import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({ limit: vi.fn(), where: vi.fn(), values: vi.fn(), onConflictDoUpdate: vi.fn() }));
vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: mocks.where }) }),
    insert: () => ({ values: mocks.values }),
  }),
}));

import {
  CACHE_VERSION,
  TTL_SECONDS,
  dataForSeoCacheKey,
  readDataForSeoCache,
  writeDataForSeoCache,
} from "@/lib/dataforseo/cache";

const now = new Date("2026-10-19T12:00:00.000Z");
const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

describe("dataforseo response cache keys", () => {
  it("ignores object key order when hashing params", () => {
    const a = dataForSeoCacheKey("live", "backlinks/summary", { a: 1, b: { c: 2, d: 3 } });
    const b = dataForSeoCacheKey("live", "backlinks/summary", { b: { d: 3, c: 2 }, a: 1 });
    expect(a).toBe(b);
  });

  it("separates sandbox and live entries", () => {
    expect(dataForSeoCacheKey("sandbox", "backlinks/summary", { target: "x.com" }))
      .not.toBe(dataForSeoCacheKey("live", "backlinks/summary", { target: "x.com" }));
  });

  it("separates endpoints and param values", () => {
    const base = dataForSeoCacheKey("live", "backlinks/summary", { target: "x.com" });
    expect(dataForSeoCacheKey("live", "backlinks/referring_domains", { target: "x.com" })).not.toBe(base);
    expect(dataForSeoCacheKey("live", "backlinks/summary", { target: "y.com" })).not.toBe(base);
  });

  it("returns a 64-char sha256 hex key and pins the version and TTL", () => {
    const key = dataForSeoCacheKey("live", "backlinks/summary", { target: "x.com" });
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(CACHE_VERSION).toBe("v1");
    expect(TTL_SECONDS).toEqual({ backlinks: 604_800 });
  });
});

describe("dataforseo response cache reads", () => {
  beforeEach(() => {
    mocks.limit.mockReset();
    mocks.where.mockReset().mockReturnValue({ limit: mocks.limit });
    mocks.values.mockReset();
    mocks.onConflictDoUpdate.mockReset();
    consoleError.mockClear();
  });

  it("returns the stored response when an unexpired row exists", async () => {
    mocks.limit.mockResolvedValue([{ responseJson: { rank: 42 } }]);
    await expect(readDataForSeoCache<{ rank: number }>("k", now)).resolves.toEqual({ rank: 42 });
  });

  it("filters on expires_at after now", async () => {
    mocks.limit.mockResolvedValue([]);
    await readDataForSeoCache("k", now);
    const { sql, params } = new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0]);
    expect(sql).toContain("expires_at");
    expect(params).toContain("k");
    expect(params).toContain(now.toISOString());
  });

  it("returns null when no row exists", async () => {
    mocks.limit.mockResolvedValue([]);
    await expect(readDataForSeoCache("k", now)).resolves.toBeNull();
  });

  it("returns null and logs only the error name when the database throws", async () => {
    mocks.limit.mockRejectedValue(new TypeError("connection refused with payload secret"));
    await expect(readDataForSeoCache("k", now)).resolves.toBeNull();
    expect(consoleError).toHaveBeenCalledWith("[dataforseo] cache read failed", { error: "TypeError" });
  });
});

describe("dataforseo response cache writes", () => {
  beforeEach(() => {
    mocks.limit.mockReset();
    mocks.where.mockReset();
    mocks.values.mockReset().mockReturnValue({ onConflictDoUpdate: mocks.onConflictDoUpdate });
    mocks.onConflictDoUpdate.mockReset().mockResolvedValue(undefined);
    consoleError.mockClear();
  });

  it("upserts with expires_at set to now plus the ttl", async () => {
    const value = { backlinks: 10 };
    await writeDataForSeoCache("k", "backlinks/summary", value, TTL_SECONDS.backlinks, now);
    const expiresAt = new Date(now.getTime() + TTL_SECONDS.backlinks * 1000);
    expect(mocks.values).toHaveBeenCalledWith({
      cacheKey: "k",
      endpoint: "backlinks/summary",
      responseJson: value,
      fetchedAt: now,
      expiresAt,
    });
    expect(mocks.onConflictDoUpdate).toHaveBeenCalledWith(expect.objectContaining({
      set: { responseJson: value, fetchedAt: now, expiresAt },
    }));
  });

  it("swallows and logs only the error name when the database throws", async () => {
    mocks.onConflictDoUpdate.mockRejectedValue(new RangeError("payload leak"));
    await expect(writeDataForSeoCache("k", "backlinks/summary", {}, 60, now)).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith("[dataforseo] cache write failed", { error: "RangeError" });
  });
});
