import { and, desc, eq, inArray } from "drizzle-orm";

import {
  clusterKeyForDocuments,
  computeFeatures,
  decideStatus,
  recommendedAction,
  scoreFeatures,
} from "@/lib/opportunities/features";
import type {
  BuildOpportunitiesResult,
  OpportunityCardView,
  OpportunityDetailView,
  OpportunityEvidenceView,
  OpportunityFeatures,
  OpportunityStatus,
} from "@/lib/opportunities/types";
import { getDb } from "@/lib/db/client";
import {
  document,
  opportunity,
  opportunityEvidence,
  type Opportunity,
} from "@/lib/db/schema";
import {
  normalizeDocuments,
  type NormalizedDocument,
} from "@/lib/pipeline/normalize";

const QUEUE_STATUSES: OpportunityStatus[] = [
  "opportunity",
  "monitor",
  "review",
];

function featuresFromRow(
  raw: Record<string, number | string | boolean> | null | undefined,
): OpportunityFeatures {
  const r = raw ?? {};
  return {
    fit: Number(r.fit ?? 0) || 0,
    intent: Number(r.intent ?? 0) || 0,
    evidence: Number(r.evidence ?? 0) || 0,
    momentum: Number(r.momentum ?? 0) || 0,
    timing: Number(r.timing ?? 0) || 0,
    modelConfidence: Number(r.modelConfidence ?? 0) || 0,
    lowConfidence: Boolean(r.lowConfidence),
  };
}

function toCard(
  row: Opportunity,
  evidenceCount: number,
): OpportunityCardView {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    status: row.status as OpportunityStatus,
    title: row.title,
    summary: row.summary,
    whyItMatters: row.whyItMatters,
    whyNow: row.whyNow,
    recommendedAction: row.recommendedAction,
    confidence: row.confidence,
    urgency: row.urgency,
    score: row.score,
    coverage: row.coverage,
    features: featuresFromRow(row.features),
    evidenceCount,
    clusterKey: row.clusterKey,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function clusterDocuments(
  docs: NormalizedDocument[],
): Map<string, NormalizedDocument[]> {
  // First pass: each doc alone, then merge by shared cluster key of pairs
  const groups = new Map<string, NormalizedDocument[]>();
  for (const doc of docs) {
    const key = clusterKeyForDocuments([doc]);
    // Try to find an existing group with overlapping key prefix/tokens
    let placed = false;
    for (const [existingKey, list] of groups) {
      const merged = clusterKeyForDocuments([...list, doc]);
      const overlap = merged.split(":")[1]?.split("-") ?? [];
      const existingTokens = existingKey.split(":")[1]?.split("-") ?? [];
      const shared = overlap.filter((t) => existingTokens.includes(t));
      if (shared.length >= 1 || list[0]?.platform === doc.platform && shared.length >= 0 && overlap[0] === existingTokens[0] && overlap[0]) {
        // Prefer merge when first content token matches on same platform
        if (shared.length >= 1 || (list[0]?.platform === doc.platform && overlap[0] && overlap[0] === existingTokens[0])) {
          groups.delete(existingKey);
          groups.set(merged, [...list, doc]);
          placed = true;
          break;
        }
      }
    }
    if (!placed) {
      const bucket = groups.get(key) ?? [];
      bucket.push(doc);
      groups.set(key, bucket);
    }
  }
  return groups;
}

function titleFor(docs: NormalizedDocument[]): string {
  const withTitle = docs.find((d) => d.title?.trim());
  if (withTitle?.title) return withTitle.title.trim().slice(0, 160);
  return docs[0]?.text.trim().slice(0, 120) || "Untitled opportunity";
}

function summarize(docs: NormalizedDocument[]): string {
  return docs
    .map((d) => (d.title ? d.title : d.text.slice(0, 80)))
    .slice(0, 5)
    .join(" · ")
    .slice(0, 400);
}

/**
 * Cluster workspace documents into opportunities, upsert by cluster key,
 * and return the ranked queue (max 5 strong cards, excluding pure ignore).
 */
export async function buildOpportunities(opts: {
  workspaceId: string;
  limitDocs?: number;
}): Promise<BuildOpportunitiesResult> {
  const db = getDb();
  const limitDocs = Math.min(Math.max(opts.limitDocs ?? 200, 1), 500);

  const rows = await db
    .select()
    .from(document)
    .where(eq(document.workspaceId, opts.workspaceId))
    .orderBy(desc(document.collectedAt))
    .limit(limitDocs);

  const normalized = normalizeDocuments(rows);

  const clusters = clusterDocuments(normalized);
  let upserted = 0;

  for (const [clusterKey, docs] of clusters) {
    const features = computeFeatures(docs);
    const status = decideStatus(features);
    const score = scoreFeatures(features);
    const title = titleFor(docs);
    const summary = summarize(docs);
    const whyItMatters = `Fit ${features.fit.toFixed(2)}, intent ${features.intent.toFixed(2)} across ${docs.length} evidence item(s).`;
    const whyNow = `Timing ${features.timing.toFixed(2)}, momentum ${features.momentum.toFixed(2)}.`;
    const action = recommendedAction(status);
    const coverage = features.lowConfidence ? "review" : status;
    const providers = [
      ...new Set(
        docs.map((d) => {
          // provider lives on original row metadata when available
          const raw = rows.find((r) => r.id === d.id);
          const p = raw?.metadata?.provider;
          return typeof p === "string" ? p : null;
        }).filter(Boolean),
      ),
    ];
    const coverageLabel =
      providers.length > 0 ? providers.join(",") : coverage;

    const existing = await db
      .select()
      .from(opportunity)
      .where(
        and(
          eq(opportunity.workspaceId, opts.workspaceId),
          eq(opportunity.clusterKey, clusterKey),
        ),
      )
      .limit(1);

    let opportunityId: string;
    const now = new Date();
    if (existing[0]) {
      const updated = await db
        .update(opportunity)
        .set({
          status,
          title,
          summary,
          whyItMatters,
          whyNow,
          recommendedAction: action,
          confidence: features.modelConfidence,
          urgency: features.timing,
          score,
          coverage: coverageLabel,
          features,
          updatedAt: now,
        })
        .where(eq(opportunity.id, existing[0].id))
        .returning({ id: opportunity.id });
      opportunityId = updated[0]?.id ?? existing[0].id;
    } else {
      const inserted = await db
        .insert(opportunity)
        .values({
          workspaceId: opts.workspaceId,
          status,
          title,
          summary,
          whyItMatters,
          whyNow,
          recommendedAction: action,
          confidence: features.modelConfidence,
          urgency: features.timing,
          score,
          coverage: coverageLabel,
          features,
          clusterKey,
        })
        .returning({ id: opportunity.id });
      opportunityId = inserted[0]!.id;
    }

    for (const doc of docs) {
      await db
        .insert(opportunityEvidence)
        .values({
          workspaceId: opts.workspaceId,
          opportunityId,
          documentId: doc.id,
        })
        .onConflictDoNothing({
          target: [
            opportunityEvidence.opportunityId,
            opportunityEvidence.documentId,
          ],
        });
    }
    upserted += 1;
  }

  const top = await listOpportunityQueue({
    workspaceId: opts.workspaceId,
    limit: 5,
  });

  return {
    scanned: normalized.length,
    clusters: clusters.size,
    upserted,
    top,
  };
}

export async function listOpportunityQueue(opts: {
  workspaceId: string;
  limit?: number;
}): Promise<OpportunityCardView[]> {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 5, 1), 5);
  const rows = await db
    .select()
    .from(opportunity)
    .where(
      and(
        eq(opportunity.workspaceId, opts.workspaceId),
        inArray(opportunity.status, QUEUE_STATUSES),
      ),
    )
    .orderBy(desc(opportunity.score), desc(opportunity.updatedAt))
    .limit(limit);

  const cards: OpportunityCardView[] = [];
  for (const row of rows) {
    const evidenceRows = await db
      .select()
      .from(opportunityEvidence)
      .where(eq(opportunityEvidence.opportunityId, row.id));
    cards.push(toCard(row, evidenceRows.length));
  }
  return cards;
}

export async function getOpportunityDetail(opts: {
  workspaceId: string;
  opportunityId: string;
}): Promise<OpportunityDetailView | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(opportunity)
    .where(
      and(
        eq(opportunity.id, opts.opportunityId),
        eq(opportunity.workspaceId, opts.workspaceId),
      ),
    )
    .limit(1);
  if (!row) return null;

  const evidenceJoin = await db
    .select({
      evidence: opportunityEvidence,
      doc: document,
    })
    .from(opportunityEvidence)
    .innerJoin(document, eq(document.id, opportunityEvidence.documentId))
    .where(eq(opportunityEvidence.opportunityId, row.id));

  const evidence: OpportunityEvidenceView[] = evidenceJoin.map((e) => ({
    documentId: e.doc.id,
    title: e.doc.title,
    urlCanonical: e.doc.urlCanonical,
    platform: e.doc.platform,
    contentMd: e.doc.contentMd,
    postedAt: e.doc.postedAt ? e.doc.postedAt.toISOString() : null,
    provider:
      typeof e.doc.metadata?.provider === "string"
        ? e.doc.metadata.provider
        : null,
  }));

  return {
    ...toCard(row, evidence.length),
    evidence,
  };
}
