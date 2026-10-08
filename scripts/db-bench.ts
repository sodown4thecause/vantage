/**
 * Driver benchmark for the query mix a typical scan issues. Not run in tests.
 * Usage (operator, with an explicit connection string):
 *   DATABASE_URL=... pnpm tsx scripts/db-bench.ts --driver=neon-http --workspace=<uuid> [--iterations=20]
 *   DATABASE_URL=... pnpm tsx scripts/db-bench.ts --driver=postgres-js --workspace=<uuid> [--iterations=20]
 * Refuses to run without an explicit DATABASE_URL. Prints p50/p95 per query and for the
 * whole mix. Writes are net-zero: a lease is claimed and released, and the budget
 * "reserve" adds 0. Use a workspace with no scan running. See docs/hyperdrive.md.
 */
import { neon } from "@neondatabase/serverless";
import { and, count, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { pathToFileURL } from "node:url";

import type { SharedDb } from "../lib/db/client";
import {
  budgetDay,
  document,
  providerBudgetDay,
  source,
  sourceSwitch,
  workspace,
} from "../lib/db/schema";
import * as schema from "../lib/db/schema";

const DRIVERS = ["neon-http", "postgres-js"] as const;
type Driver = (typeof DRIVERS)[number];

const DEFAULT_ITERATIONS = 20;
const DOCUMENT_SELECTS = 50;
const LEASE_TTL_MINUTES = 1;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type BenchContext = {
  workspaceId: string;
  documentIds: string[];
  contentHashes: string[];
  leaseToken: string | null;
};

type BenchQuery = {
  name: string;
  run(db: SharedDb, ctx: BenchContext): Promise<unknown>;
};

/** The 12 queries, in the order a scan issues them. */
const QUERIES: BenchQuery[] = [
  {
    name: "01 workspace by id",
    run: (db, ctx) => db.select().from(workspace).where(eq(workspace.id, ctx.workspaceId)).limit(1),
  },
  {
    name: "02 list sources",
    run: (db, ctx) => db.select().from(source).where(eq(source.workspaceId, ctx.workspaceId)),
  },
  {
    name: "03 list source switches",
    run: (db) => db.select().from(sourceSwitch),
  },
  {
    name: "04 claim scan lease",
    run: async (db, ctx) => {
      const token = crypto.randomUUID();
      const [claimed] = await db
        .update(workspace)
        .set({
          scanLeaseToken: token,
          scanLeaseUntil: sql`now() + make_interval(mins => ${LEASE_TTL_MINUTES}::int)`,
        })
        .where(
          and(
            eq(workspace.id, ctx.workspaceId),
            or(isNull(workspace.scanLeaseUntil), lt(workspace.scanLeaseUntil, sql`now()`)),
          ),
        )
        .returning({ id: workspace.id });
      ctx.leaseToken = claimed ? token : null;
      return claimed;
    },
  },
  {
    name: "05 release scan lease",
    run: (db, ctx) =>
      db
        .update(workspace)
        .set({ scanLeaseToken: null, scanLeaseUntil: null, updatedAt: new Date() })
        .where(and(eq(workspace.id, ctx.workspaceId), eq(workspace.scanLeaseToken, ctx.leaseToken ?? "")))
        .returning({ id: workspace.id }),
  },
  {
    name: `06 ${DOCUMENT_SELECTS} document selects by id`,
    run: async (db, ctx) => {
      for (let i = 0; i < DOCUMENT_SELECTS; i += 1) {
        const id = ctx.documentIds[i % ctx.documentIds.length];
        await db.select().from(document).where(eq(document.id, id)).limit(1);
      }
    },
  },
  {
    name: "07 document by content hash",
    run: (db, ctx) =>
      db
        .select({ id: document.id })
        .from(document)
        .where(and(eq(document.workspaceId, ctx.workspaceId), eq(document.contentHash, ctx.contentHashes[0])))
        .limit(1),
  },
  {
    name: "08 count unembedded documents",
    run: (db, ctx) =>
      db
        .select({ n: count() })
        .from(document)
        .where(and(eq(document.workspaceId, ctx.workspaceId), isNull(document.embeddedAt))),
  },
  {
    name: "09 recent documents",
    run: (db, ctx) =>
      db
        .select({ id: document.id })
        .from(document)
        .where(eq(document.workspaceId, ctx.workspaceId))
        .orderBy(desc(document.collectedAt))
        .limit(20),
  },
  {
    name: "10 read budget day",
    run: (db) => db.select().from(budgetDay).where(eq(budgetDay.day, sql`current_date`)),
  },
  {
    name: "11 read provider budget day",
    run: (db) => db.select().from(providerBudgetDay).where(eq(providerBudgetDay.day, sql`current_date`)),
  },
  {
    name: "12 budget reserve (adds 0)",
    run: (db) =>
      db
        .update(providerBudgetDay)
        .set({ spentUsd: sql`${providerBudgetDay.spentUsd} + 0` })
        .where(eq(providerBudgetDay.day, sql`current_date`))
        .returning({ day: providerBudgetDay.day }),
  },
];

/** Nearest-rank percentile over a sorted-ascending copy of the samples. */
export function percentile(samples: number[], p: number): number {
  if (samples.length === 0) throw new RangeError("percentile needs at least one sample");
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1];
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (const arg of argv) {
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (!match) throw new Error(`Unrecognised argument: ${arg}`);
    args[match[1]] = match[2];
  }
  return args;
}

/** Opens the driver and returns a `close` that ends its pool (a no-op for neon-http). */
async function openDb(driver: Driver, url: string): Promise<{ db: SharedDb; close: () => Promise<void> }> {
  if (driver === "neon-http") {
    return { db: drizzleNeon(neon(url), { schema }), close: async () => {} };
  }
  // Lazy import: postgres-js is only needed for this driver.
  const [{ drizzle }, { default: postgres }] = await Promise.all([
    import("drizzle-orm/postgres-js"),
    import("postgres"),
  ]);
  const client = postgres(url, { max: 5, fetch_types: false });
  return { db: drizzle(client, { schema }), close: () => client.end({ timeout: 5 }) };
}

/** Releases the lease this run still holds, so a failed iteration cannot block scans until the TTL expires. */
async function releaseLease(db: SharedDb, ctx: BenchContext): Promise<void> {
  if (!ctx.leaseToken) return;
  await db
    .update(workspace)
    .set({ scanLeaseToken: null, scanLeaseUntil: null, updatedAt: new Date() })
    .where(and(eq(workspace.id, ctx.workspaceId), eq(workspace.scanLeaseToken, ctx.leaseToken)));
  ctx.leaseToken = null;
}

async function loadContext(db: SharedDb, workspaceId: string): Promise<BenchContext> {
  const docs = await db
    .select({ id: document.id, contentHash: document.contentHash })
    .from(document)
    .where(eq(document.workspaceId, workspaceId))
    .limit(DOCUMENT_SELECTS);
  if (docs.length === 0) {
    throw new Error("The workspace has no documents. Pick a workspace with at least one document.");
  }
  return {
    workspaceId,
    documentIds: docs.map((doc) => doc.id),
    contentHashes: docs.map((doc) => doc.contentHash),
    leaseToken: null,
  };
}

export async function main(argv: string[], env: NodeJS.ProcessEnv): Promise<void> {
  const url = env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("DATABASE_URL is required. This benchmark has no default connection.");
  }
  const args = parseArgs(argv);
  const driver = args.driver as Driver | undefined;
  if (!driver || !DRIVERS.includes(driver)) {
    throw new Error(`--driver must be one of: ${DRIVERS.join(", ")}`);
  }
  if (!args.workspace || !UUID_PATTERN.test(args.workspace)) {
    throw new Error("--workspace=<uuid> is required.");
  }
  const iterations = args.iterations === undefined ? DEFAULT_ITERATIONS : Number(args.iterations);
  if (!Number.isInteger(iterations) || iterations <= 0) {
    throw new Error("--iterations must be a positive integer.");
  }

  const { db, close } = await openDb(driver, url);
  const ctx = await loadContext(db, args.workspace);
  console.log(`driver=${driver} workspace=${ctx.workspaceId} iterations=${iterations}`);

  const samples: number[][] = QUERIES.map(() => []);
  const totals: number[] = [];
  try {
    // One untimed warm-up pass so connection setup is not billed to the first sample.
    for (const query of QUERIES) await query.run(db, ctx);

    for (let i = 0; i < iterations; i += 1) {
      let total = 0;
      for (let q = 0; q < QUERIES.length; q += 1) {
        const start = performance.now();
        await QUERIES[q].run(db, ctx);
        const elapsed = performance.now() - start;
        samples[q].push(elapsed);
        total += elapsed;
      }
      totals.push(total);
    }
  } finally {
    await releaseLease(db, ctx);
    await close();
  }

  const rows = QUERIES.map((query, q) => ({
    query: query.name,
    p50_ms: percentile(samples[q], 50).toFixed(1),
    p95_ms: percentile(samples[q], 95).toFixed(1),
  }));
  rows.push({
    query: "TOTAL (one scan's mix)",
    p50_ms: percentile(totals, 50).toFixed(1),
    p95_ms: percentile(totals, 95).toFixed(1),
  });
  console.table(rows);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : "benchmark failed");
    process.exitCode = 1;
  });
}
