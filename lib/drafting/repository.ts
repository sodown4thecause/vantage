import { and, desc, eq } from "drizzle-orm";

import {
  assertCopyAllowed,
  parseContributionReview,
  type DraftCitation,
  type DraftFlag,
  type ContributionReview,
} from "@/lib/drafting/generate";
import { generateContribution, validateContribution } from "@/lib/drafting/contribution";
import { contributionRule } from "@/lib/drafting/rules";
import { getDb } from "@/lib/db/client";
import { monitoringProfile, opportunityDraft } from "@/lib/db/schema";
import { getOpportunityDetail } from "@/lib/opportunities/run";

export class DraftInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftInputError";
  }
}

export type DraftView = {
  id: string;
  workspaceId: string;
  opportunityId: string;
  originalText: string;
  editedText: string;
  citations: DraftCitation[];
  flags: DraftFlag[];
  quality: ContributionReview | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function toView(row: typeof opportunityDraft.$inferSelect): DraftView {
  const quality = parseContributionReview(row.quality);
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    opportunityId: row.opportunityId,
    originalText: row.originalText,
    editedText: row.editedText,
    citations: Array.isArray(row.citations) ? row.citations.filter(citation => citation &&
      typeof citation.label === "string" && typeof citation.url === "string" &&
      (citation.documentId === undefined || typeof citation.documentId === "string")) : [],
    flags: Array.isArray(row.flags) ? row.flags.filter(flag => flag &&
      typeof flag.claim === "string" && typeof flag.reason === "string") : [],
    quality,
    approvedAt: quality && row.approvedAt ? row.approvedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createDraftForOpportunity(opts: {
  workspaceId: string;
  opportunityId: string;
  targetDocumentId?: string;
  rulesReviewed?: boolean;
  signal?: AbortSignal;
}): Promise<DraftView> {
  const db = getDb();
  const detail = await getOpportunityDetail({
    workspaceId: opts.workspaceId,
    opportunityId: opts.opportunityId,
  });
  if (!detail) {
    throw new DraftInputError("opportunity not found");
  }

  const profiles = await db
    .select()
    .from(monitoringProfile)
    .where(eq(monitoringProfile.workspaceId, opts.workspaceId))
    .orderBy(desc(monitoringProfile.version))
    .limit(1);
  const profile = profiles[0];

  const target = detail.evidence.find(e => e.documentId === opts.targetDocumentId) ?? (!opts.targetDocumentId ? detail.evidence[0] : undefined);
  if (!target) throw new DraftInputError("Conversation evidence not found.");
  const orderedEvidence = [target, ...detail.evidence.filter(e => e.documentId !== target.documentId)];
  const generated = await generateContribution({
    productDescription: profile?.productDescription ?? "",
    targetCustomer: profile?.targetCustomer ?? "",
    productMaterialText: profile?.productMaterialText ?? "",
    opportunityTitle: detail.title,
    opportunitySummary: detail.summary,
    recommendedAction: detail.recommendedAction,
    existingReplies: target.existingReplies,
    evidence: orderedEvidence.map((e) => ({
      documentId: e.documentId,
      title: e.title,
      urlCanonical: e.urlCanonical,
      contentMd: e.contentMd,
      platform: e.platform,
      discoveryOnly: e.discoveryOnly,
    })),
  }, { workspaceId: opts.workspaceId, rulesReviewed: opts.rulesReviewed, signal: opts.signal });

  const inserted = await db
    .insert(opportunityDraft)
    .values({
      workspaceId: opts.workspaceId,
      opportunityId: opts.opportunityId,
      originalText: generated.originalText,
      editedText: generated.originalText,
      citations: generated.citations,
      flags: generated.flags,
      quality: generated.quality,
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
  if (!opts.editedText.trim() || opts.editedText.length > 12_000) throw new DraftInputError("Draft text must be between 1 and 12,000 characters.");
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
  if (!row) throw new DraftInputError("draft not found");

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
  factsReviewed?: boolean;
  rulesReviewed?: boolean;
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
  if (!row) throw new DraftInputError("draft not found");

  const quality = parseContributionReview(row.quality);
  if (!quality) throw new DraftInputError("Regenerate this draft to review its evidence and community rules.");
  if (quality.kind === "abstain") throw new DraftInputError("No reply is recommended for this conversation.");
  const detail = await getOpportunityDetail({ workspaceId: opts.workspaceId, opportunityId: row.opportunityId });
  const target = detail?.evidence.find(e => e.documentId === quality.targetDocumentId);
  if (!target) throw new DraftInputError("Conversation evidence is no longer available. Refresh this opportunity.");
  const rule = contributionRule(target.platform, target.urlCanonical);
  if (quality.kind === "brief") {
    if (row.editedText !== row.originalText) throw new DraftInputError("Research briefs must be copied as reference material.");
  } else {
    if (rule.aiText === "prohibited") throw new DraftInputError(`${rule.venue} prohibits AI-written contributions.`);
    if (!opts.rulesReviewed || !opts.factsReviewed) throw new DraftInputError("Review the facts and this community's rules before handoff.");
    validateContribution({ decision: "draft", text: row.editedText, angle: quality.angle, gap: quality.gap.note,
      claims: quality.claims.filter(c => row.editedText.includes(c.sentence)) }, {
      productDescription: "", targetCustomer: "", productMaterialText: "", opportunityTitle: detail!.title,
      opportunitySummary: detail!.summary, recommendedAction: detail!.recommendedAction,
      evidence: [target, ...detail!.evidence.filter(e => e.documentId !== target.documentId)],
      existingReplies: target.existingReplies,
    }, quality.model || "unknown");
  }

  const allowed = quality.kind === "brief" ? { ok: true as const } : assertCopyAllowed({
    editedText: row.editedText,
    flags: (row.flags ?? []) as DraftFlag[],
  });
  if (!allowed.ok) {
    throw new DraftInputError(allowed.error);
  }

  const updated = await db
    .update(opportunityDraft)
    .set({ approvedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(opportunityDraft.id, row.id),
      eq(opportunityDraft.workspaceId, opts.workspaceId),
      eq(opportunityDraft.editedText, row.editedText),
    ))
    .returning();
  if (!updated[0]) throw new DraftInputError("Draft changed during review. Reload and review the latest text.");
  return toView(updated[0]!);
}
