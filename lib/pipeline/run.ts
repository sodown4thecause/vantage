import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import type { DocumentRecord, Lead } from "@/lib/db/schema";
import { document, lead } from "@/lib/db/schema";
import {
  classifyIntent,
  shouldCreateLead,
} from "@/lib/pipeline/intent-ladder";
import { normalizeDocuments } from "@/lib/pipeline/normalize";
import { normalizePipelineOptions } from "@/lib/pipeline/options";

export async function runPipeline(opts: {
  workspaceId: string;
  limit?: unknown;
  threshold?: unknown;
}) {
  const db = getDb();
  const { threshold, limit } = normalizePipelineOptions(opts);

  const docs = await db
    .select()
    .from(document)
    .where(eq(document.workspaceId, opts.workspaceId))
    .orderBy(desc(document.collectedAt))
    .limit(limit);

  // Skip docs that already have a lead
  const existingLeads = await db
    .select({ documentId: lead.documentId })
    .from(lead)
    .where(eq(lead.workspaceId, opts.workspaceId));
  const hasLead = new Set(existingLeads.map((l) => l.documentId));

  const fresh = docs.filter((d) => !hasLead.has(d.id));
  const normalized = normalizeDocuments(fresh);

  let created = 0;
  let skipped = 0;
  const intents = [];

  for (const n of normalized) {
    const intent = classifyIntent(n);
    intents.push(intent);
    if (!shouldCreateLead(intent, threshold)) {
      skipped += 1;
      continue;
    }
    await db.insert(lead).values({
      workspaceId: opts.workspaceId,
      documentId: n.id,
      intentRung: intent.intentRung,
      confidence: intent.confidence,
      score: intent.score,
      factors: intent.factors,
      reason: intent.reason,
      status: "new",
    });
    created += 1;
  }

  return {
    scanned: fresh.length,
    normalized: normalized.length,
    created,
    skipped,
    threshold,
    sample: intents.slice(0, 10),
  };
}

export type ReviewQueueRow = { lead: Lead; document: DocumentRecord };

export async function listReviewQueue(
  workspaceId: string,
  limit = 50,
): Promise<ReviewQueueRow[]> {
  const page = await listReviewQueuePage({ workspaceId, limit });
  return page.rows;
}

export type ReviewQueueCursor = {
  score: number;
  createdAt: Date;
  id: string;
};

export function encodeReviewQueueCursor(cursor: ReviewQueueCursor): string {
  return Buffer.from(
    JSON.stringify([cursor.score, cursor.createdAt.toISOString(), cursor.id]),
  ).toString("base64url");
}

export function decodeReviewQueueCursor(
  value: string | undefined,
): ReviewQueueCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const [score, createdAt, id] = Array.isArray(parsed) ? parsed : [];
    if (typeof score !== "number" || typeof createdAt !== "string" || typeof id !== "string") {
      return null;
    }
    const date = new Date(createdAt);
    return Number.isNaN(date.getTime()) ? null : { score, createdAt: date, id };
  } catch {
    return null;
  }
}

export const REVIEW_QUEUE_PAGE_SIZE = 50;

/**
 * Keyset-paginated review queue. Ordering is (score desc, createdAt desc, id
 * desc); the cursor is the last row of the previous page so results stay
 * stable while leads are being actioned.
 */
export async function listReviewQueuePage(opts: {
  workspaceId: string;
  limit?: number;
  cursor?: string;
}): Promise<{ rows: ReviewQueueRow[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? REVIEW_QUEUE_PAGE_SIZE, 1), 100);
  const cursor = decodeReviewQueueCursor(opts.cursor);
  const db = getDb();

  const rows = await db
    .select({
      lead,
      document,
    })
    .from(lead)
    .innerJoin(document, eq(document.id, lead.documentId))
    .where(
      and(
        eq(lead.workspaceId, opts.workspaceId),
        inArray(lead.status, ["new", "queued", "reviewing"]),
        cursor
          ? sql`(${lead.score}, ${lead.createdAt}, ${lead.id}) < (${cursor.score}, ${cursor.createdAt}, ${cursor.id})`
          : undefined,
      ),
    )
    .orderBy(desc(lead.score), desc(lead.createdAt), desc(lead.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1)?.lead;
  const nextCursor =
    rows.length > limit && last
      ? encodeReviewQueueCursor({
          score: last.score,
          createdAt: last.createdAt,
          id: last.id,
        })
      : null;

  return { rows: page, nextCursor };
}

/** Total leads waiting in the queue, for the queue-size header. */
export async function countReviewQueue(workspaceId: string): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(lead)
    .where(
      and(
        eq(lead.workspaceId, workspaceId),
        inArray(lead.status, ["new", "queued", "reviewing"]),
      ),
    );
  return row?.count ?? 0;
}
