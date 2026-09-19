import { and, desc, eq, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
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

export async function listReviewQueue(workspaceId: string, limit = 50) {
  const db = getDb();
  return db
    .select({
      lead,
      document,
    })
    .from(lead)
    .innerJoin(document, eq(document.id, lead.documentId))
    .where(
      and(
        eq(lead.workspaceId, workspaceId),
        inArray(lead.status, ["new", "queued", "reviewing"]),
      ),
    )
    .orderBy(desc(lead.score), desc(lead.createdAt))
    .limit(limit);
}
