import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "@/lib/db/schema";

type VantageDb = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as unknown as {
  vantageDb?: VantageDb;
};

/**
 * Shared Drizzle client. Requires DATABASE_URL (Neon pooled connection string).
 * Lazily constructed so `next build` / typecheck work without secrets.
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
