/**
 * Manual, idempotent seed of provider_price from DEFAULT_PRICES.
 * Run by a human against a chosen branch: `DATABASE_URL=... pnpm tsx scripts/seed-prices.ts`.
 * Never part of deploy. Rows that already exist for (provider, action) are left alone.
 */
import { and, eq } from "drizzle-orm";

import { DEFAULT_PRICES } from "../lib/costs/prices";
import { getDb } from "../lib/db/client";
import { providerPrice } from "../lib/db/schema";

async function main() {
  const db = getDb();
  let inserted = 0;
  for (const p of DEFAULT_PRICES) {
    const existing = await db
      .select({ id: providerPrice.id })
      .from(providerPrice)
      .where(and(eq(providerPrice.provider, p.provider), eq(providerPrice.action, p.action)))
      .limit(1);
    if (existing.length) continue;
    await db.insert(providerPrice).values({
      provider: p.provider,
      action: p.action,
      unitCostUsd: p.unitCostUsd.toFixed(6),
      unit: p.unit,
      notes: p.notes,
    });
    inserted += 1;
  }
  console.log(`seeded ${inserted} of ${DEFAULT_PRICES.length} provider_price rows`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
