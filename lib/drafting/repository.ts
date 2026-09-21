import { and, desc, eq } from "drizzle-orm";

import {
  assertCopyAllowed,
  generateGroundedDraft,
  type DraftCitation,
  type DraftFlag,
} from "@/lib/drafting/generate";
import { getDb } from "@/lib/db/client";
import { monitoringProfile, opportunityDraft } from "@/lib/db/schema";
import { getOpportunityDetail } from "@/lib/opportunities/run";

export type DraftView = {
  id: string;
  workspaceId: string;
  opportunityId: string;
  originalText: string;
  editedText: string;
  citations: DraftCitation[];
  flags: DraftFlag[];
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function toView(row: typeof opportunityDraft.$inferSelect): DraftView {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    opportunityId: row.opportunityId,
    originalText: row.originalText,
    editedText: row.editedText,
    citations: (row.citations ?? []) as DraftCitation[],
    flags: (row.flags ?? []) as DraftFlag[],
    approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createDraftForOpportunity(opts: {
  workspaceId: string;
  opportunityId: string;
}): Promise<DraftView> {
  const db = getDb();
  const detail = await getOpportunityDetail({
    workspaceId: opts.workspaceId,
    opportunityId: opts.opportunityId,
  });
  if (!detail) {
    throw new Error("opportunity not found");
  }

  const profiles = await db
    .select()
    .from(monitoringProfile)
    .where(eq(monitoringProfile.workspaceId, opts.workspaceId))
    .orderBy(desc(monitoringProfile.version))
    .limit(1);
  const profile = profiles[0];

  const generated = generateGroundedDraft({
    productDescription: profile?.productDescription ?? "",
    targetCustomer: profile?.targetCustomer ?? "",
    productMaterialText: profile?.productMaterialText ?? "",
    opportunityTitle: detail.title,
    opportunitySummary: detail.summary,
    recommendedAction: detail.recommendedAction,
    evidence: detail.evidence.map((e) => ({
      documentId: e.documentId,
      title: e.title,
      urlCanonical: e.urlCanonical,
      contentMd: e.contentMd,
      platform: e.platform,
    })),
  });

  const inserted = await db
    .insert(opportunityDraft)
    .values({
      workspaceId: opts.workspaceId,
      opportunityId: opts.opportunityId,
      originalText: generated.originalText,
      editedText: generated.originalText,
      citations: generated.citations,
      flags: generated.flags,
    })
    .returning();

  return toView(inserted[0]!);
}

export async function getLatestDraft(opts: {
  workspaceId: string;
  opportunityId: string;
}): Promise<DraftView | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(opportunityDraft)
    .where(
      and(
        eq(opportunityDraft.workspaceId, opts.workspaceId),
        eq(opportunityDraft.opportunityId, opts.opportunityId),
      ),
    )
    .orderBy(desc(opportunityDraft.createdAt))
    .limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

export async function updateDraftText(opts: {
  workspaceId: string;
  draftId: string;
  editedText: string;
}): Promise<DraftView> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(opportunityDraft)
    .where(
      and(
        eq(opportunityDraft.id, opts.draftId),
        eq(opportunityDraft.workspaceId, opts.workspaceId),
      ),
    )
    .limit(1);
  if (!row) throw new Error("draft not found");

  const updated = await db
    .update(opportunityDraft)
    .set({
      editedText: opts.editedText,
      updatedAt: new Date(),
      approvedAt: null,
    })
    .where(eq(opportunityDraft.id, row.id))
    .returning();
  return toView(updated[0]!);
}

/**
 * Mark draft approved for copy/open-conversation handoff only after claim checks.
 * There is intentionally no publish endpoint.
 */
export async function approveDraftForHandoff(opts: {
  workspaceId: string;
  draftId: string;
}): Promise<DraftView> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(opportunityDraft)
    .where(
      and(
        eq(opportunityDraft.id, opts.draftId),
        eq(opportunityDraft.workspaceId, opts.workspaceId),
      ),
    )
    .limit(1);
  if (!row) throw new Error("draft not found");

  const allowed = assertCopyAllowed({
    editedText: row.editedText,
    flags: (row.flags ?? []) as DraftFlag[],
  });
  if (!allowed.ok) {
    throw new Error(allowed.error);
  }

  const updated = await db
    .update(opportunityDraft)
    .set({ approvedAt: new Date(), updatedAt: new Date() })
    .where(eq(opportunityDraft.id, row.id))
    .returning();
  return toView(updated[0]!);
}
