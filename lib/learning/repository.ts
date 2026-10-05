import { and, desc, eq, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import {
  document,
  opportunity,
  opportunityEvidence,
  opportunityOutcome,
  workspacePreferenceModel,
  type WorkspacePreferenceModel,
} from "@/lib/db/schema";
import {
  resolveLearningConfig,
  type LearningConfig,
} from "@/lib/learning/config";
import {
  buildPreferenceModel,
  findRawContentLeakage,
  intentTermsForDocuments,
  sourceIdsForDocuments,
  topicTermsForDocuments,
} from "@/lib/learning/signals";
import { featuresFromRecord } from "@/lib/opportunities/features";
import {
  decisionForEvent,
  resolveDecision,
  type LearningSample,
  type PreferenceModel,
} from "@/lib/learning/types";
import type { OutcomeEvent } from "@/lib/outcomes/types";
import { normalizeDocuments } from "@/lib/pipeline/normalize";

function toModel(row: WorkspacePreferenceModel): PreferenceModel {
  return {
    workspaceId: row.workspaceId,
    version: row.version,
    weights: row.weights ?? [],
    positiveEvents: row.positiveEvents,
    negativeEvents: row.negativeEvents,
    evidence: row.evidence,
    active: row.active,
    disabledReason: row.disabledReason as PreferenceModel["disabledReason"],
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Replay inputs for one workspace: its recorded decisions joined back to the
 * documents behind each opportunity. Every query filters on `workspaceId` so
 * preference features can never cross workspaces.
 */
export async function collectLearningSamples(opts: {
  workspaceId: string;
  limit?: number;
}): Promise<LearningSample[]> {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 2_000);

  const outcomeRows = await db
    .select()
    .from(opportunityOutcome)
    .where(eq(opportunityOutcome.workspaceId, opts.workspaceId))
    .orderBy(desc(opportunityOutcome.createdAt))
    .limit(limit);

  if (outcomeRows.length === 0) return [];

  const opportunityIds = [
    ...new Set(outcomeRows.map((row) => row.opportunityId)),
  ];

  const evidenceJoin = await db
    .select({ opportunityId: opportunityEvidence.opportunityId, doc: document })
    .from(opportunityEvidence)
    .innerJoin(document, eq(document.id, opportunityEvidence.documentId))
    .where(
      and(
        eq(opportunityEvidence.workspaceId, opts.workspaceId),
        inArray(opportunityEvidence.opportunityId, opportunityIds),
      ),
    );

  const docsByOpportunity = new Map<string, typeof evidenceJoin>();
  for (const row of evidenceJoin) {
    const bucket = docsByOpportunity.get(row.opportunityId) ?? [];
    bucket.push(row);
    docsByOpportunity.set(row.opportunityId, bucket);
  }

  const decisionRows = await db
    .select({ id: opportunity.id, status: opportunity.status, features: opportunity.features })
    .from(opportunity)
    .where(
      and(
        eq(opportunity.workspaceId, opts.workspaceId),
        inArray(opportunity.id, opportunityIds),
      ),
    );
  const opportunityById = new Map(decisionRows.map((row) => [row.id, row]));

  const decisionsByOpportunity = new Map<string, Array<"positive" | "negative" | "none">>();
  for (const row of outcomeRows) {
    const decision = decisionForEvent(row.event as OutcomeEvent);
    const bucket = decisionsByOpportunity.get(row.opportunityId) ?? [];
    bucket.push(decision);
    decisionsByOpportunity.set(row.opportunityId, bucket);
  }

  const samples: LearningSample[] = [];
  for (const [opportunityId, decisions] of decisionsByOpportunity) {
    const decision = resolveDecision(decisions);
    if (decision === "none") continue;

    const rows = docsByOpportunity.get(opportunityId) ?? [];
    const docs = normalizeDocuments(rows.map((row) => row.doc));
    const sourceIdByDocId = new Map(rows.map((row) => [row.doc.id, row.doc.sourceId]));
    const stored = opportunityById.get(opportunityId)?.features;
    // An opportunity with no stored vector is not scorable, so it must not
    // enter a replay holdout as a spurious zero-scoring candidate.
    const hasFeatures =
      !!stored && Object.keys(stored as object).length > 0;

    samples.push({
      opportunityId,
      decision,
      topics: topicTermsForDocuments(docs),
      sourceIds: sourceIdsForDocuments(docs, sourceIdByDocId),
      intents: intentTermsForDocuments(docs),
      ...(hasFeatures
        ? {
            features: featuresFromRecord(
              stored as Record<string, number | string | boolean>,
            ),
          }
        : {}),
    });
  }

  return samples;
}

/** Persist a new version. Refuses any payload that looks like collected content. */
export async function savePreferenceModel(opts: {
  workspaceId: string;
  model: PreferenceModel;
}): Promise<PreferenceModel> {
  if (opts.model.workspaceId !== opts.workspaceId) {
    throw new Error("preference model workspace mismatch");
  }
  const violations = findRawContentLeakage(
    opts.model.weights as unknown as Array<Record<string, unknown>>,
  );
  if (violations.length > 0) {
    throw new Error(
      `preference model rejected: raw content leakage (${violations.join("; ")})`,
    );
  }

  const db = getDb();
  const inserted = await db
    .insert(workspacePreferenceModel)
    .values({
      workspaceId: opts.workspaceId,
      version: opts.model.version,
      weights: opts.model.weights,
      positiveEvents: opts.model.positiveEvents,
      negativeEvents: opts.model.negativeEvents,
      evidence: opts.model.evidence,
      active: opts.model.active,
      disabledReason: opts.model.disabledReason,
      enabled: false,
    })
    .returning();

  const row = inserted[0];
  if (!row) throw new Error("failed to persist preference model");
  return toModel(row);
}

export async function listPreferenceModels(opts: {
  workspaceId: string;
  limit?: number;
}): Promise<PreferenceModel[]> {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const rows = await db
    .select()
    .from(workspacePreferenceModel)
    .where(eq(workspacePreferenceModel.workspaceId, opts.workspaceId))
    .orderBy(desc(workspacePreferenceModel.version))
    .limit(limit);
  return rows.map(toModel);
}

export async function getLatestPreferenceModel(
  workspaceId: string,
): Promise<PreferenceModel | null> {
  const rows = await listPreferenceModels({ workspaceId, limit: 1 });
  return rows[0] ?? null;
}

/**
 * The version allowed to affect ranking right now, or null.
 *
 * Returns null when the feature flag is off, when no version has been explicitly
 * enabled, or when the enabled version's evidence no longer clears the
 * threshold. That last check is what makes rollback and threshold changes take
 * effect immediately, with no rebuild or migration.
 */
export async function getActivePreferenceModel(opts: {
  workspaceId: string;
  config?: LearningConfig;
}): Promise<PreferenceModel | null> {
  const config = opts.config ?? resolveLearningConfig();
  if (!config.enabled) return null;

  const db = getDb();
  const rows = await db
    .select()
    .from(workspacePreferenceModel)
    .where(
      and(
        eq(workspacePreferenceModel.workspaceId, opts.workspaceId),
        eq(workspacePreferenceModel.enabled, true),
        eq(workspacePreferenceModel.active, true),
      ),
    )
    .orderBy(desc(workspacePreferenceModel.version))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.evidence < config.minWorkspaceEvidence) return null;
  return toModel(row);
}

/**
 * Enable or disable one version for a workspace. Setting `enabled: false` is the
 * instant rollback: the workspace falls back to the previous enabled version, or
 * to the deterministic baseline when none is left.
 */
export async function setPreferenceModelEnabled(opts: {
  workspaceId: string;
  version: number;
  enabled: boolean;
}): Promise<PreferenceModel> {
  const db = getDb();
  const updated = await db
    .update(workspacePreferenceModel)
    .set({ enabled: opts.enabled })
    .where(
      and(
        eq(workspacePreferenceModel.workspaceId, opts.workspaceId),
        eq(workspacePreferenceModel.version, opts.version),
      ),
    )
    .returning();

  const row = updated[0];
  if (!row) throw new Error("preference model version not found");
  return toModel(row);
}

/**
 * Derive the next version from recorded outcomes. New versions are stored
 * disabled, so an operator must review the offline evaluation and enable one
 * explicitly — building a model never changes ranking on its own.
 */
export async function rebuildPreferenceModel(opts: {
  workspaceId: string;
  config?: LearningConfig;
  limit?: number;
}): Promise<PreferenceModel> {
  const config = opts.config ?? resolveLearningConfig();
  const samples = await collectLearningSamples({
    workspaceId: opts.workspaceId,
    limit: opts.limit,
  });
  const latest = await getLatestPreferenceModel(opts.workspaceId);
  const model = buildPreferenceModel({
    workspaceId: opts.workspaceId,
    version: (latest?.version ?? 0) + 1,
    samples,
    config,
  });
  return savePreferenceModel({ workspaceId: opts.workspaceId, model });
}