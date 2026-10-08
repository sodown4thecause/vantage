import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  throwContext: false,
  env: {} as Record<string, unknown>,
}));

const mocks = vi.hoisted(() => ({
  neon: vi.fn((url: string) => ({ kind: "neon-sql", url })),
  postgres: vi.fn((url: string, options: unknown) => ({ url, options, end: async () => {} })),
}));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    if (state.throwContext) throw new Error("no cloudflare context");
    return { env: state.env };
  },
}));

vi.mock("@neondatabase/serverless", () => ({
  neon: mocks.neon,
  neonConfig: {},
}));

vi.mock("drizzle-orm/neon-http", () => ({
  drizzle: (client: unknown) => ({ driver: "neon-http", client }),
}));

vi.mock("drizzle-orm/postgres-js", () => ({
  drizzle: (client: unknown) => {
    const instance = {
      driver: "postgres-js",
      client,
      $client: client,
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(instance),
    };
    return instance;
  },
}));

vi.mock("postgres", () => ({ default: mocks.postgres }));

const originalDriver = process.env.VANTAGE_DB_DRIVER;
const originalDatabaseUrl = process.env.DATABASE_URL;
const FRESH_URL = "postgres://fresh.example/vantage";
const CACHED_URL = "postgres://cached.example/vantage";

type ClientModule = typeof import("@/lib/db/client");

async function loadClient(): Promise<ClientModule> {
  // Each test gets a fresh module so the warn-once state and the getDb() cache start clean.
  vi.resetModules();
  delete (globalThis as { vantageDb?: unknown }).vantageDb;
  return import("@/lib/db/client");
}

beforeAll(async () => {
  // The first import transforms the whole schema graph, which can exceed the 5s default when
  // the full suite runs one worker per file; later tests reuse the transformed modules.
  await loadClient();
}, 30_000);

beforeEach(() => {
  state.throwContext = false;
  state.env = {};
  process.env.DATABASE_URL = "postgres://neon.example/vantage";
  delete process.env.VANTAGE_DB_DRIVER;
  vi.clearAllMocks();
});

afterEach(() => {
  if (originalDriver === undefined) delete process.env.VANTAGE_DB_DRIVER;
  else process.env.VANTAGE_DB_DRIVER = originalDriver;
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  vi.restoreAllMocks();
});

describe("getDb (default driver)", () => {
  it("returns the neon-http instance when VANTAGE_DB_DRIVER is unset", async () => {
    const { getDb } = await loadClient();
    const db = getDb() as unknown as { driver: string; client: { kind: string; url: string } };
    expect(db.driver).toBe("neon-http");
    expect(db.client).toEqual({ kind: "neon-sql", url: "postgres://neon.example/vantage" });
    expect(mocks.postgres).not.toHaveBeenCalled();
  });

  it("stays synchronous and neon-only even when the Hyperdrive flag is on", async () => {
    process.env.VANTAGE_DB_DRIVER = "hyperdrive";
    state.env = { HYPERDRIVE_FRESH: { connectionString: FRESH_URL } };
    const { getDb } = await loadClient();
    const db = getDb() as unknown as { driver: string };
    expect(db.driver).toBe("neon-http");
    expect(mocks.postgres).not.toHaveBeenCalled();
  });

  it("throws the existing message when DATABASE_URL is missing", async () => {
    delete process.env.DATABASE_URL;
    const { getDb } = await loadClient();
    expect(() => getDb()).toThrow("DATABASE_URL is not set");
  });
});

describe("getReadDb and getFreshDb with the Hyperdrive flag off", () => {
  it("equal getDb() when VANTAGE_DB_DRIVER is unset", async () => {
    const { getDb, getReadDb, getFreshDb } = await loadClient();
    expect(await getReadDb()).toBe(getDb());
    expect(await getFreshDb()).toBe(getDb());
    expect(mocks.postgres).not.toHaveBeenCalled();
  });
});

describe("Hyperdrive driver", () => {
  it("falls back to neon-http with one warning when the binding is missing", async () => {
    process.env.VANTAGE_DB_DRIVER = "hyperdrive";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { getDb, getFreshDb } = await loadClient();

    const first = await getFreshDb();
    const again = await getFreshDb();

    expect(first).toBe(getDb());
    expect(again).toBe(getDb());
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("HYPERDRIVE_FRESH");
    expect(mocks.postgres).not.toHaveBeenCalled();
  });

  it("falls back to neon-http when the Cloudflare context is unavailable", async () => {
    process.env.VANTAGE_DB_DRIVER = "hyperdrive";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    state.throwContext = true;
    const { getDb, getFreshDb } = await loadClient();
    expect(await getFreshDb()).toBe(getDb());
  });

  it("chooses postgres-js with the fresh connection string and returns distinct instances per call", async () => {
    process.env.VANTAGE_DB_DRIVER = "hyperdrive";
    state.env = { HYPERDRIVE: { connectionString: CACHED_URL }, HYPERDRIVE_FRESH: { connectionString: FRESH_URL } };
    const { getFreshDb } = await loadClient();

    const first = (await getFreshDb()) as unknown as { driver: string; client: { url: string } };
    const second = await getFreshDb();

    expect(first.driver).toBe("postgres-js");
    expect(first.client.url).toBe(FRESH_URL);
    expect(second).not.toBe(first);
    expect(mocks.postgres).toHaveBeenCalledTimes(2);
    expect(mocks.postgres).toHaveBeenCalledWith(FRESH_URL, expect.objectContaining({ max: 5, fetch_types: false }));
  });

  it("uses the cached HYPERDRIVE binding for getReadDb", async () => {
    process.env.VANTAGE_DB_DRIVER = "hyperdrive";
    state.env = { HYPERDRIVE: { connectionString: CACHED_URL }, HYPERDRIVE_FRESH: { connectionString: FRESH_URL } };
    const { getReadDb } = await loadClient();

    const read = (await getReadDb()) as unknown as { driver: string; client: { url: string } };

    expect(read.driver).toBe("postgres-js");
    expect(read.client.url).toBe(CACHED_URL);
  });

  it("withTransaction runs the callback on the fresh postgres-js instance", async () => {
    process.env.VANTAGE_DB_DRIVER = "hyperdrive";
    state.env = { HYPERDRIVE_FRESH: { connectionString: FRESH_URL } };
    const { withTransaction } = await loadClient();

    const result = await withTransaction(async (tx) => {
      expect((tx as unknown as { driver: string }).driver).toBe("postgres-js");
      return 42;
    });

    expect(result).toBe(42);
  });
});

describe("withTransaction on neon-http", () => {
  it("throws exactly 'Transactions require the Hyperdrive driver' when the flag is unset", async () => {
    const { withTransaction } = await loadClient();
    await expect(withTransaction(async () => 1)).rejects.toThrow(
      new Error("Transactions require the Hyperdrive driver"),
    );
  });

  it("throws the same message when the flag is on but the fresh binding is absent", async () => {
    process.env.VANTAGE_DB_DRIVER = "hyperdrive";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { withTransaction } = await loadClient();
    await expect(withTransaction(async () => 1)).rejects.toThrow("Transactions require the Hyperdrive driver");
    expect(mocks.postgres).not.toHaveBeenCalled();
  });
});
