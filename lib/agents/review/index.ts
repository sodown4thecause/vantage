import { and, desc, eq, gte, isNotNull } from "drizzle-orm";

import { remainingDiscoveryBudgetUsd, type SpentReader } from "@/lib/agents/discovery/budget";
import { loadReviewProfile } from "@/lib/agents/discovery/profile";
import { specificTerms, termsIn, type ReviewProfile } from "@/lib/agents/discovery/relevance";
import { getDb } from "@/lib/db/client";
import { document, source, sourceProposal } from "@/lib/db/schema";

/*
 * The ingestion feedback loop. After a scan, look at the documents each source recently inserted and flag the sources
 * that mostly return documents with no link to the product, proposing their removal. It runs as a step in the existing
 * scan Workflow. It only proposes: the owner decides, and accepting pauses the source rather than deleting it.
 *
 * Judging is the same deterministic test the source quality gate uses (does the document name something specific to
 * the product?), so this loop makes no model calls and spends nothing today. It still honours the per-workspace daily
 * review budget so that adding a model step later cannot overspend.
 */

export const MIN_DOCS_TO_JUDGE = 5;
/** Flag a source when at least this share of its recent documents are irrelevant. */
export const IRRELEVANT_SHARE = 0.8;
const WINDOW_DAYS = 14;
const MAX_DOCS = 500;
const DOC_TEXT_CHARS = 1500;

export type ReviewDoc = { title: string | null; text: string };
export type NoisySource = { sourceId: string; name: string; type: string; total: number; irrelevant: number };

export function documentIsRelevant(profile: ReviewProfile, doc: ReviewDoc, vocabulary: Set<string> = specificTerms(profile)): boolean {
  return termsIn(`${doc.title ?? ""} ${doc.text.slice(0, DOC_TEXT_CHARS)}`).some((term) => vocabulary.has(term));
}

export function flagNoisySources(
  profile: ReviewProfile,
  sources: Array<{ id: string; name: string; type: string; docs: ReviewDoc[] }>,
): NoisySource[] {
  const vocabulary = specificTerms(profile);
  return sources.flatMap((s) => {
    if (s.docs.length < MIN_DOCS_TO_JUDGE) return [];
    const irrelevant = s.docs.filter((doc) => !documentIsRelevant(profile, doc, vocabulary)).length;
    return irrelevant / s.docs.length >= IRRELEVANT_SHARE ? [{ sourceId: s.id, name: s.name, type: s.type, total: s.docs.length, irrelevant }] : [];
  });
}

type Db = ReturnType<typeof getDb>;
export type ReviewResult = { checked: number; flagged: string[]; skipped?: "budget" | "no_profile" };

export async function reviewIngestedDocuments(
  workspaceId: string,
  deps: { db?: Db; readSpent?: SpentReader; env?: Record<string, string | undefined>; now?: Date } = {},
): Promise<ReviewResult> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const remaining = await remainingDiscoveryBudgetUsd(workspaceId, "review", { readSpent: deps.readSpent, env: deps.env, now });
  if (remaining <= 0) return { checked: 0, flagged: [], skipped: "budget" };
  const profile = await loadReviewProfile(workspaceId, db);
  if (!profile) return { checked: 0, flagged: [], skipped: "no_profile" };

  const sources = await db.select({ id: source.id, name: source.name, type: source.type, health: source.health })
    .from(source).where(eq(source.workspaceId, workspaceId)).limit(100);
  const live = sources.filter((s) => s.health !== "paused");
  const since = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const docs = await db.select({ sourceId: document.sourceId, title: document.title, contentMd: document.contentMd })
    .from(document)
    .where(and(eq(document.workspaceId, workspaceId), isNotNull(document.sourceId), gte(document.collectedAt, since)))
    .orderBy(desc(document.collectedAt)).limit(MAX_DOCS);

  const grouped = live.map((s) => ({
    id: s.id, name: s.name, type: s.type,
    docs: docs.filter((d) => d.sourceId === s.id).map((d) => ({ title: d.title, text: d.contentMd })),
  })).filter((s) => s.docs.length > 0);
  const flagged = flagNoisySources(profile, grouped);

  for (const noisy of flagged) {
    await db.insert(sourceProposal).values({
      workspaceId, action: "remove", sourceId: noisy.sourceId, sourceType: noisy.type, name: noisy.name, queries: [],
      rationale: `${noisy.irrelevant} of the last ${noisy.total} documents from this source mention nothing specific to your product.`,
      accepted: false, status: "removal_proposed",
    }).onConflictDoNothing({ target: [sourceProposal.workspaceId, sourceProposal.name, sourceProposal.action] });
  }
  return { checked: grouped.length, flagged: flagged.map((f) => f.name) };
}
