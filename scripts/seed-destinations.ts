/**
 * Manual, idempotent seed of the destination catalog from data/destinations.json.
 * Run by a human against a chosen branch: `DATABASE_URL=... pnpm tsx scripts/seed-destinations.ts`.
 * Never part of deploy. Validates every row first and aborts without writing if any row is invalid.
 * Existing slugs are updated only when their last_verified date is older than the file's; otherwise
 * left alone so a hand-corrected row is never overwritten by an older seed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { eq } from "drizzle-orm";

import { getDb } from "../lib/db/client";
import { destination } from "../lib/db/schema";
import { validateCatalog } from "../lib/destinations/validate";

async function main() {
  const raw = JSON.parse(readFileSync(join(process.cwd(), "data", "destinations.json"), "utf8")) as unknown;
  const { rows, errors } = validateCatalog(raw);
  if (errors.length > 0) {
    for (const e of errors) console.error(`row ${e.index} (${e.slug || "no slug"}): ${e.errors.join("; ")}`);
    throw new Error(`${errors.length} invalid destination row(s); nothing was written`);
  }

  const db = getDb();
  let inserted = 0;
  let updated = 0;
  for (const row of rows) {
    const existing = await db
      .select({ id: destination.id, lastVerified: destination.lastVerified })
      .from(destination)
      .where(eq(destination.slug, row.slug))
      .limit(1);
    if (!existing.length) {
      await db.insert(destination).values(row);
      inserted += 1;
    } else if (existing[0].lastVerified < row.lastVerified) {
      await db.update(destination).set(row).where(eq(destination.id, existing[0].id));
      updated += 1;
    }
  }
  console.log(`destination seed: ${inserted} inserted, ${updated} updated, ${rows.length} in file`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
