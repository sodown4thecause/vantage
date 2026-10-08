import { and, asc, desc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import {
  destination,
  destinationChange,
  type Destination,
  type DestinationChange,
  type DestinationChangeStatus,
  type DestinationKind,
} from "@/lib/db/schema";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** All catalog rows, newest-verified facts are not reordered: sorted by name for stable pages. */
export async function listDestinations(opts: { kind?: DestinationKind } = {}): Promise<Destination[]> {
  const db = getDb();
  const query = db.select().from(destination);
  const rows = await (opts.kind ? query.where(eq(destination.kind, opts.kind)) : query).orderBy(
    asc(destination.name),
  );
  return rows;
}

/** One row by slug, or null. A malformed slug never reaches the database. */
export async function getDestinationBySlug(slug: string): Promise<Destination | null> {
  if (!SLUG.test(slug)) return null;
  const db = getDb();
  const rows = await db.select().from(destination).where(eq(destination.slug, slug)).limit(1);
  return rows[0] ?? null;
}

/** Proposed edits for review; defaults to pending, newest first. */
export async function listDestinationChanges(
  opts: { destinationId?: string; status?: DestinationChangeStatus; limit?: number } = {},
): Promise<DestinationChange[]> {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const conditions = [eq(destinationChange.status, opts.status ?? "pending")];
  if (opts.destinationId) conditions.push(eq(destinationChange.destinationId, opts.destinationId));
  return db
    .select()
    .from(destinationChange)
    .where(and(...conditions))
    .orderBy(desc(destinationChange.detectedAt))
    .limit(limit);
}
