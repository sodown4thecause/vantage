import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { PostgresJsDatabase, PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";

import { readBinding } from "@/lib/cf/env";
import * as schema from "@/lib/db/schema";

type VantageDb = ReturnType<typeof drizzle<typeof schema>>;
type PostgresJsInstance = { db: PostgresJsDatabase<typeof schema>; client: { end(options?: { timeout?: number }): Promise<void> } };

neonConfig.fetchFunction = (input: RequestInfo | URL, init?: RequestInit) => {
  const timeout = AbortSignal.timeout(10_000);
  return fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
};

const globalForDb = globalThis as unknown as {
  vantageDb?: VantageDb;
};

/**
 * Shared Drizzle client. Requires DATABASE_URL (Neon pooled connection string).
 * Lazily constructed so `next build` / typecheck work without secrets.
 * The neon-http driver does not support interactive transactions; use atomic
 * statements or `db.batch()` when several statements must be submitted together.
 * Always neon-http: the Hyperdrive seam is async, so it lives in getReadDb(),
 * getFreshDb() and withTransaction() below.
 */
export function getDb(): VantageDb {
  if (globalForDb.vantageDb) {
    return globalForDb.vantageDb;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and add your Neon connection string.",
    );
  }
  const sql = neon(url);
  const instance = drizzle(sql, { schema });
  if (process.env.NODE_ENV !== "production") {
    globalForDb.vantageDb = instance;
  }
  return instance;
}

/** Proxy for ergonomic `db.select()` usage; prefer getDb() in new code. */
export const db = new Proxy({} as VantageDb, {
  get(_target, prop, receiver) {
    const real = getDb() as unknown as Record<PropertyKey, unknown>;
    const value = Reflect.get(real, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export type Db = VantageDb;

/**
 * Query surface common to the neon-http and postgres-js drizzle instances. Returned by
 * getReadDb() and getFreshDb(). A union of the two driver types would not be callable
 * for write builders (`.update().set().returning()`), so the seam uses this base type.
 */
export type SharedDb = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * Transaction callback handle on the postgres-js driver. The postgres-js transaction
 * object is a PgDatabase but not a PostgresJsDatabase (it has no `$client`).
 */
export type TxDb = PgDatabase<PostgresJsQueryResultHKT, typeof schema>;

/** Hyperdrive binding with caching (60s reads). Public read pages only. */
const CACHED_BINDING = "HYPERDRIVE";
/** Hyperdrive binding with caching disabled. Leases, budgets, switches, read-after-write. */
const FRESH_BINDING = "HYPERDRIVE_FRESH";

/** True only for VANTAGE_DB_DRIVER=hyperdrive. Unset or unrecognised values keep neon-http. */
export function isHyperdriveDriver(): boolean {
  return process.env.VANTAGE_DB_DRIVER?.trim() === "hyperdrive";
}

const warnedBindings = new Set<string>();

async function hyperdriveConnectionString(binding: string): Promise<string | null> {
  const value = await readBinding(binding);
  if (typeof value === "object" && value !== null && "connectionString" in value && typeof value.connectionString === "string") {
    return value.connectionString;
  }
  // Never log the connection string or the binding value; the binding name is enough.
  if (!warnedBindings.has(binding)) {
    warnedBindings.add(binding);
    console.warn(`[db] VANTAGE_DB_DRIVER=hyperdrive but the ${binding} binding is missing; using neon-http.`);
  }
  return null;
}

/**
 * Per-request postgres-js instance. Deliberately not cached on globalThis: Hyperdrive
 * pools connections itself, and a Worker must not hold sockets across requests.
 * The driver is imported here so default bundles never load postgres-js.
 */
async function createPostgresJsDb(connectionString: string): Promise<PostgresJsInstance> {
  const [{ drizzle: drizzlePg }, { default: postgres }] = await Promise.all([
    import("drizzle-orm/postgres-js"),
    import("postgres"),
  ]);
  const client = postgres(connectionString, { max: 5, fetch_types: false });
  return { db: drizzlePg(client, { schema }), client };
}

async function hyperdriveOrNeon(binding: string): Promise<SharedDb> {
  if (!isHyperdriveDriver()) return getDb();
  const connectionString = await hyperdriveConnectionString(binding);
  if (!connectionString) return getDb();
  return (await createPostgresJsDb(connectionString)).db;
}

/** Runs `fn` on a per-call database and closes its postgres-js pool afterwards (neon-http is never closed). */
async function scopedDb<T>(binding: string, fn: (db: SharedDb) => Promise<T>): Promise<T> {
  if (!isHyperdriveDriver()) return fn(getDb());
  const connectionString = await hyperdriveConnectionString(binding);
  if (!connectionString) return fn(getDb());
  const { db, client } = await createPostgresJsDb(connectionString);
  try {
    return await fn(db);
  } finally {
    // A close failure must not replace fn's result or error; the timeout stops in-flight queries from stalling it.
    await client.end({ timeout: 5 }).catch(() => {});
  }
}

/**
 * Runs `fn` against the cached Hyperdrive config, closing its pool when `fn` settles. Prefer this
 * over getReadDb() so no socket outlives the request.
 */
export function withReadDb<T>(fn: (db: SharedDb) => Promise<T>): Promise<T> {
  return scopedDb(CACHED_BINDING, fn);
}

/** Scoped variant of getFreshDb(): cache-disabled Hyperdrive config, pool closed when `fn` settles. */
export function withFreshDb<T>(fn: (db: SharedDb) => Promise<T>): Promise<T> {
  return scopedDb(FRESH_BINDING, fn);
}

/**
 * Database for public read pages. Uses the cached Hyperdrive config when the
 * Hyperdrive driver is on, otherwise exactly getDb(). Do not use for lease,
 * budget, switch or read-after-write queries: use getFreshDb() for those.
 * With Hyperdrive on, the returned postgres-js pool is NOT closed here; prefer withReadDb().
 */
export function getReadDb(): Promise<SharedDb> {
  return hyperdriveOrNeon(CACHED_BINDING);
}

/**
 * Database for lease, budget, switch and read-after-write queries. Uses the
 * cache-disabled Hyperdrive config when the Hyperdrive driver is on, otherwise getDb().
 * With Hyperdrive on, the returned postgres-js pool is NOT closed here; prefer withFreshDb().
 */
export function getFreshDb(): Promise<SharedDb> {
  return hyperdriveOrNeon(FRESH_BINDING);
}

/**
 * Runs `fn` in a database transaction on the cache-disabled Hyperdrive config.
 * neon-http has no interactive transactions, so this throws unless the Hyperdrive
 * driver is on and the HYPERDRIVE_FRESH binding is present.
 */
export async function withTransaction<T>(fn: (tx: TxDb) => Promise<T>): Promise<T> {
  const connectionString = isHyperdriveDriver() ? await hyperdriveConnectionString(FRESH_BINDING) : null;
  if (!connectionString) {
    throw new Error("Transactions require the Hyperdrive driver");
  }
  const { db: instance, client } = await createPostgresJsDb(connectionString);
  try {
    return await instance.transaction(fn);
  } finally {
    await client.end();
  }
}
