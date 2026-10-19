import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({
  limit: vi.fn(),
  orderBy: vi.fn(),
  where: vi.fn(),
  from: vi.fn(),
  insertTarget: vi.fn(),
  values: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  onConflictDoUpdate: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    select: () => ({ from: (table: unknown) => { mocks.from(table); return { where: mocks.where }; } }),
    insert: (table: unknown) => { mocks.insertTarget(table); return { values: mocks.values }; },
    update: mocks.update,
    delete: mocks.remove,
  }),
}));

import { dataforseoCache, dataforseoSnapshot } from "@/lib/db/schema";
import {
  CACHE_VERSION,
  FRESHNESS_SECONDS,
  dataForSeoCacheKey,
  readDataForSeoCache,
  writeDataForSeoCache,
} from "@/lib/dataforseo/cache";

const now = new Date("2026-10-19T12:00:00.000Z");
const BACKLINKS_FRESHNESS = 2_592_000;
const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

const compile = (node: unknown) => new PgDialect().sqlToQuery(node as Parameters<PgDialect["sqlToQuery"]>[0]);

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

  it("returns a 64-char sha256 hex key and pins the version and freshness windows", () => {
    const key = dataForSeoCacheKey("live", "backlinks/summary", { target: "x.com" });
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(CACHE_VERSION).toBe("v1");
    expect(FRESHNESS_SECONDS).toEqual({
      backlinks: 2_592_000,
      keywords: 2_592_000,
      aiKeywords: 2_592_000,
      serp: 604_800,
      llm: 604_800,
    });
  });
});

describe("dataforseo response cache reads", () => {
  beforeEach(() => {
    mocks.limit.mockReset().mockResolvedValue([]);
    mocks.orderBy.mockReset().mockReturnValue({ limit: mocks.limit });
    mocks.where.mockReset().mockReturnValue({ orderBy: mocks.orderBy, limit: mocks.limit });
    mocks.from.mockReset();
    mocks.insertTarget.mockReset();
    mocks.values.mockReset();
    mocks.update.mockReset();
    mocks.remove.mockReset();
    mocks.onConflictDoUpdate.mockReset();
    consoleError.mockClear();
  });

  it("returns the newest fresh snapshot's response", async () => {
    mocks.limit.mockResolvedValueOnce([{ responseJson: { rank: 42 } }]);
    await expect(readDataForSeoCache<{ rank: number }>("k", BACKLINKS_FRESHNESS, now)).resolves.toEqual({ rank: 42 });
    expect(mocks.from).toHaveBeenNthCalledWith(1, dataforseoSnapshot);
  });

  it("orders snapshots newest first and keeps only one row", async () => {
    mocks.limit.mockResolvedValueOnce([{ responseJson: { rank: 2 } }]);
    await readDataForSeoCache("k", BACKLINKS_FRESHNESS, now);
    expect(mocks.orderBy).toHaveBeenCalledTimes(1);
    expect(compile(mocks.orderBy.mock.calls[0][0]).sql).toMatch(/"fetched_at" desc/i);
    expect(mocks.limit).toHaveBeenCalledWith(1);
  });

  it("only accepts snapshots fetched after now minus the freshness window", async () => {
    await readDataForSeoCache("k", BACKLINKS_FRESHNESS, now);
    const { sql, params } = compile(mocks.where.mock.calls[0][0]);
    expect(sql).toContain("fetched_at");
    expect(params).toContain("k");
    expect(params).toContain(new Date(now.getTime() - BACKLINKS_FRESHNESS * 1000).toISOString());
  });

  it("returns null when the only snapshot is older than the window and no legacy row is live", async () => {
    // The database filters stale snapshots out, so an old row never comes back from the snapshot query.
    mocks.limit.mockResolvedValue([]);
    await expect(readDataForSeoCache("k", BACKLINKS_FRESHNESS, now)).resolves.toBeNull();
    expect(mocks.from).toHaveBeenCalledWith(dataforseoCache);
  });

  it("returns a live legacy row when no snapshot is fresh", async () => {
    mocks.limit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ responseJson: { legacy: true } }]);
    await expect(readDataForSeoCache("k", BACKLINKS_FRESHNESS, now)).resolves.toEqual({ legacy: true });
    expect(mocks.from).toHaveBeenNthCalledWith(2, dataforseoCache);
    const { sql, params } = compile(mocks.where.mock.calls[1][0]);
    expect(sql).toContain("expires_at");
    expect(params).toContain(now.toISOString());
  });

  it("prefers a fresh snapshot over a legacy row without reading the legacy table", async () => {
    mocks.limit.mockResolvedValueOnce([{ responseJson: { fresh: true } }]);
    await expect(readDataForSeoCache("k", BACKLINKS_FRESHNESS, now)).resolves.toEqual({ fresh: true });
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it("returns null when neither table has a row", async () => {
    await expect(readDataForSeoCache("k", BACKLINKS_FRESHNESS, now)).resolves.toBeNull();
  });

  it("returns null and logs only the error name when the database throws", async () => {
    mocks.limit.mockRejectedValue(new TypeError("connection refused with payload secret"));
    await expect(readDataForSeoCache("k", BACKLINKS_FRESHNESS, now)).resolves.toBeNull();
    expect(consoleError).toHaveBeenCalledWith("[dataforseo] cache read failed", { error: "TypeError" });
  });
});

describe("dataforseo response cache writes", () => {
  beforeEach(() => {
    mocks.values.mockReset().mockResolvedValue(undefined);
    mocks.insertTarget.mockReset();
    mocks.update.mockReset();
    mocks.remove.mockReset();
    mocks.onConflictDoUpdate.mockReset();
    consoleError.mockClear();
  });

  it("inserts a new snapshot row into dataforseo_snapshot", async () => {
    const value = { backlinks: 10 };
    await expect(writeDataForSeoCache("k", "backlinks/summary", value)).resolves.toBeUndefined();
    expect(mocks.insertTarget).toHaveBeenCalledExactlyOnceWith(dataforseoSnapshot);
    expect(mocks.values).toHaveBeenCalledExactlyOnceWith({
      cacheKey: "k",
      endpoint: "backlinks/summary",
      responseJson: value,
    });
  });

  it("never updates, deletes or upserts", async () => {
    await writeDataForSeoCache("k", "backlinks/summary", { backlinks: 10 });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.onConflictDoUpdate).not.toHaveBeenCalled();
  });

  it("swallows and logs only the error name when the database throws", async () => {
    mocks.values.mockRejectedValue(new RangeError("payload leak"));
    await expect(writeDataForSeoCache("k", "backlinks/summary", {})).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith("[dataforseo] cache write failed", { error: "RangeError" });
  });
});

describe("dataforseo snapshots are append-only", () => {
  const libDir = fileURLToPath(new URL("../lib", import.meta.url));
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  const DELETE_SNAPSHOT = /delete\s*\(\s*dataforseoSnapshot\b|delete\s+from\s+"?dataforseo_snapshot\b/i;

  it("no file under lib/ deletes from dataforseo_snapshot", () => {
    const offenders = walk(libDir)
      .filter((file) => /\.(ts|tsx|mjs|js)$/.test(file))
      .filter((file) => DELETE_SNAPSHOT.test(readFileSync(file, "utf8")))
      .map((file) => relative(process.cwd(), file));
    expect(offenders).toEqual([]);
  });
});
