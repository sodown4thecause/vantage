import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";

import {
  clusterKeyForDocuments,
  computeFeatures,
  decideStatus,
  featuresFromRecord,
  recommendedAction,
} from "@/lib/opportunities/features";
import type {
  BuildOpportunitiesResult,
  OpportunityCardView,
  OpportunityDetailView,
  OpportunityEvidenceView,
  OpportunityStatus,
} from "@/lib/opportunities/types";
import { getDb } from "@/lib/db/client";
import { documentsAreFixtureOnly } from "@/lib/collectors/coverage";
import { getLatestMonitoringProfile } from "@/lib/profile/repository";
import {
  document,
  opportunity,
  opportunityEvidence,
  type Opportunity,
  type DocumentRecord,
} from "@/lib/db/schema";
import { consume, release } from "@/lib/plans/limits";
import { resolveLearningConfig } from "@/lib/learning/config";
import { formatLearningReasons, rankWithPreferences } from "@/lib/learning/rank";
import { getActivePreferenceModel } from "@/lib/learning/repository";
import {
  intentTermsForDocuments,
  sourceIdsForDocuments,
  topicTermsForDocuments,
} from "@/lib/learning/signals";
import {
  normalizeDocuments,
  type NormalizedDocument,
} from "@/lib/pipeline/normalize";

const QUEUE_STATUSES: OpportunityStatus[] = [
  "opportunity",
  "monitor",
  "review",
];

const liveEvidenceSql = sql`coalesce(${document.postedAt}, ${document.collectedAt}) between now() - interval '7 days' and now() + interval '5 minutes'
  and ${document.metadata}->>'provider' is distinct from 'fixture'
  and coalesce(${document.metadata}->>'mocked', 'false') <> 'true'`;

function isLiveEvidence(doc: Pick<DocumentRecord, "metadata" | "postedAt" | "collectedAt">): boolean {
  const time = (doc.postedAt ?? doc.collectedAt).getTime();
  const age = Date.now() - time;
  return !documentsAreFixtureOnly([doc]) && Number.isFinite(age) && age >= -300_000 && age <= 7 * 86400_000;
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
    features: featuresFromRecord(row.features),
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
 *
 * Ranking is the deterministic baseline plus a bounded, explainable preference
 * nudge. Learning is inert unless a workspace has an enabled model version that
 * cleared the evidence threshold, and it never changes `status`.
 */
export async function buildOpportunities(opts: {
  workspaceId: string;
  limitDocs?: number;
  signal?: AbortSignal;
}): Promise<BuildOpportunitiesResult> {
  const db = getDb();
  opts.signal?.throwIfAborted();
  const limitDocs = Math.min(Math.max(Math.floor(opts.limitDocs ?? 200), 1), 200);
  const profile = await getLatestMonitoringProfile(opts.workspaceId);
  if (!profile) throw new Error("Monitoring profile required before opportunity generation.");

  const rows = await db
    .select()
    .from(document)
    .where(and(eq(document.workspaceId, opts.workspaceId), liveEvidenceSql))
    .orderBy(desc(document.collectedAt))
    .limit(limitDocs);

  const normalized = normalizeDocuments(rows.filter(isLiveEvidence));

  const learningConfig = resolveLearningConfig();
  const preferenceModel = await getActivePreferenceModel({
    workspaceId: opts.workspaceId,
    config: learningConfig,
  });
  const sourceIdByDocId = new Map(rows.map((r) => [r.id, r.sourceId]));

  const clusters = clusterDocuments(normalized);
  opts.signal?.throwIfAborted();
  // The bounded recent scan is the current queue; retire clusters it no longer supports.
  await db.update(opportunity).set({ status: "ignore", updatedAt: new Date() })
    .where(and(eq(opportunity.workspaceId, opts.workspaceId),
      clusters.size ? notInArray(opportunity.clusterKey, [...clusters.keys()]) : undefined));
  let upserted = 0;
  let budgetLimited = 0;

  for (const [clusterKey, docs] of clusters) {
    opts.signal?.throwIfAborted();
    const features = { ...computeFeatures(docs, profile), profileVersion: profile.version };
    const status = decideStatus(features);
    const ranking = rankWithPreferences({
      features,
      status,
      model: preferenceModel,
      context: {
        topics: topicTermsForDocuments(docs),
        sourceIds: sourceIdsForDocuments(docs, sourceIdByDocId),
        intents: intentTermsForDocuments(docs),
      },
      config: learningConfig,
    });
    const score = ranking.score;
    const learnedNote =
      ranking.active && ranking.reasons.length > 0
        ? ` Learned v${ranking.modelVersion} (${ranking.delta >= 0 ? "+" : "-"}${Math.abs(ranking.delta).toFixed(2)}): ${formatLearningReasons(ranking.reasons)}.`
        : "";
    const title = titleFor(docs);
    const summary = summarize(docs);
    const whyItMatters = `Product profile v${profile.version}: fit ${features.fit.toFixed(2)}, intent ${features.intent.toFixed(2)} across ${docs.length} evidence item(s).${learnedNote}`;
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

    // A new lead counts against the plan's daily scored-lead cap. Existing leads keep
    // refreshing so a capped workspace never loses what it already has.
    if (!existing[0]) {
      const spend = await consume(opts.workspaceId, "scored_leads_per_day", 1);
      if (!spend.allowed) {
        budgetLimited += 1;
        continue;
      }
    }

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
      let inserted: Array<{ id: string }>;
      try {
        inserted = await db
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
      } catch (err) {
        // The new lead was never created, so do not charge the daily quota for it (this also covers a
        // concurrent build winning the unique cluster constraint).
        await release(opts.workspaceId, "scored_leads_per_day", 1);
        throw err;
      }
      opportunityId = inserted[0]!.id;
    }

    await db.delete(opportunityEvidence).where(and(eq(opportunityEvidence.opportunityId, opportunityId),
      notInArray(opportunityEvidence.documentId, docs.map((doc) => doc.id))));
    if (docs.length) {
      await db
        .insert(opportunityEvidence)
        .values(docs.map((doc) => ({
          workspaceId: opts.workspaceId,
          opportunityId,
          documentId: doc.id,
        })))
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
    ...(budgetLimited > 0 ? { coverage: "budget_limited" as const, budgetLimited } : {}),
  };
}

export async function listOpportunityQueue(opts: {
  workspaceId: string;
  limit?: number;
}): Promise<OpportunityCardView[]> {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 5, 1), 5);
  const profile = await getLatestMonitoringProfile(opts.workspaceId);
  if (!profile) return [];
  const rows = await db
    .select()
    .from(opportunity)
    .where(
      and(
        eq(opportunity.workspaceId, opts.workspaceId),
        inArray(opportunity.status, QUEUE_STATUSES),
        sql`${opportunity.features}->>'profileVersion' = ${String(profile.version)}`,
        sql`exists (select 1 from ${opportunityEvidence}
          where ${opportunityEvidence.opportunityId} = ${opportunity.id})`,
        sql`not exists (select 1 from ${opportunityEvidence}
          inner join ${document} on ${document.id} = ${opportunityEvidence.documentId}
          where ${opportunityEvidence.opportunityId} = ${opportunity.id}
          and (not (${liveEvidenceSql})
            or ${document.workspaceId} <> ${opportunity.workspaceId}
            or ${opportunityEvidence.workspaceId} <> ${opportunity.workspaceId}))`,
      ),
    )
    .orderBy(desc(opportunity.score), desc(opportunity.updatedAt))
    .limit(limit);

  const cards: OpportunityCardView[] = [];
  for (const row of rows) {
    if (row.features?.profileVersion !== profile.version) continue;
    const evidenceRows = await db
      .select({ doc: document })
      .from(opportunityEvidence)
      .innerJoin(document, eq(document.id, opportunityEvidence.documentId))
      .where(eq(opportunityEvidence.opportunityId, row.id));
    if (!evidenceRows.length || evidenceRows.some((evidence) => !isLiveEvidence(evidence.doc))) continue;
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
  if (!row || row.status === "ignore") return null;
  const profile = await getLatestMonitoringProfile(opts.workspaceId);
  if (!profile || row.features?.profileVersion !== profile.version) return null;

  const evidenceJoin = await db
    .select({
      evidence: opportunityEvidence,
      doc: document,
    })
    .from(opportunityEvidence)
    .innerJoin(document, eq(document.id, opportunityEvidence.documentId))
    .where(eq(opportunityEvidence.opportunityId, row.id));
  if (!evidenceJoin.length || evidenceJoin.some((evidence) => !isLiveEvidence(evidence.doc))) return null;

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
