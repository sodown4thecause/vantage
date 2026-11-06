import { and, desc, eq } from "drizzle-orm";

import { reviewSourceProposal, SOURCE_RELEVANCE_THRESHOLD } from "@/lib/agents/discovery/relevance";
import { loadReviewProfile } from "@/lib/agents/discovery/profile";
import { WEB_DISCUSSIONS_PROVIDER } from "@/lib/collectors/web-provider";
import { withWorkspaceScanLease } from "@/lib/cron/lease";
import { ScanLeaseBusyError } from "@/lib/cron/lease-error";
import { getDb } from "@/lib/db/client";
import { competitor, keywordRecommendation, monitoringProfile, proposedProfile, source, sourceProposal, type NewSource } from "@/lib/db/schema";
import { hasFirecrawlApiKey } from "@/lib/firecrawl/search";
import { assertWithinCount } from "@/lib/plans/limits";
import { PlanLimitError } from "@/lib/plans/types";
import { linkupLaneEnabled } from "@/lib/reddit/client";
import { hasScavioApiKey } from "@/lib/scavio/client";
import { hasTinyFishApiKey } from "@/lib/tinyfish/client";

/*
 * Applying proposals. Each function here is called only after the caller has authorised the workspace (the server
 * actions and the discovery route do that), and every statement is scoped by workspace id. Agents never import this
 * file. Nothing here fetches a site: the profile text was read by the agent through Linkup.
 */

type Db = ReturnType<typeof getDb>;
type Env = Record<string, string | undefined>;
/** `profile_required`: a term cannot be accepted until the owner has confirmed a profile for it to join. */
export type Decision = { ok: true; value?: string; profileId?: string } | { ok: false; reason?: "profile_required" };

/** Saves the confirmed proposal as the workspace's next monitoring profile version. */
export async function confirmProfileProposal(workspaceId: string, proposalId: string, db: Db = getDb()): Promise<{ ok: true; version: number; profileId: string } | { ok: false }> {
  // Claim the proposal first, in one conditional statement, so two overlapping confirmations cannot both save a
  // version: only the caller whose UPDATE flips proposed -> accepted goes on to insert.
  const [proposal] = await db.update(proposedProfile).set({ status: "accepted", decidedAt: new Date() })
    .where(and(eq(proposedProfile.workspaceId, workspaceId), eq(proposedProfile.id, proposalId), eq(proposedProfile.status, "proposed")))
    .returning();
  if (!proposal) return { ok: false };
  try {
    const [latest] = await db.select({ version: monitoringProfile.version, topics: monitoringProfile.topics, competitors: monitoringProfile.competitors, docsUrls: monitoringProfile.docsUrls })
      .from(monitoringProfile).where(eq(monitoringProfile.workspaceId, workspaceId)).orderBy(desc(monitoringProfile.version)).limit(1);
    const version = (latest?.version ?? 0) + 1;
    const [saved] = await db.insert(monitoringProfile).values({
      workspaceId, version, productUrl: proposal.productUrl, docsUrls: latest?.docsUrls ?? [],
      productDescription: proposal.description, targetCustomer: proposal.audience,
      competitors: latest?.competitors ?? [], topics: latest?.topics ?? [],
      // The agent already read the site through Linkup, so the product text is stored as supplied material and the
      // Worker does not fetch the site again.
      productMaterialStatus: "manual",
      productMaterialText: [proposal.productName, proposal.category, proposal.description, `Audience: ${proposal.audience}`, `Pricing: ${proposal.pricingTier}`, ...proposal.differentiators].join("\n"),
      retrievalNotes: "Drafted by the discovery agent and confirmed by the owner.",
    }).returning({ id: monitoringProfile.id });
    if (!saved) throw new Error("failed to persist monitoring profile");
    return { ok: true, version, profileId: saved.id };
  } catch (error) {
    // Nothing was saved, so hand the proposal back to the owner to confirm again.
    await db.update(proposedProfile).set({ status: "proposed", decidedAt: null })
      .where(and(eq(proposedProfile.workspaceId, workspaceId), eq(proposedProfile.id, proposalId), eq(proposedProfile.status, "accepted")));
    throw error;
  }
}

type SavedProfile = typeof monitoringProfile.$inferSelect;

async function latestSavedProfile(workspaceId: string, db: Db): Promise<SavedProfile | undefined> {
  const [latest] = await db.select().from(monitoringProfile).where(eq(monitoringProfile.workspaceId, workspaceId))
    .orderBy(desc(monitoringProfile.version)).limit(1);
  return latest;
}

/**
 * Opportunity scoring reads the latest saved monitoring profile, so a term the owner accepted has to be on it. This
 * saves the next profile version with the term added and everything else copied, and returns its id (null when the
 * term was already there or the plan's keyword limit leaves no room; the term is still accepted and searched).
 * neon-http has no interactive transactions, so a version clash from a rival save is retried against the new latest.
 */
async function addTermToProfile(workspaceId: string, field: "competitors" | "topics", term: string, latest: SavedProfile, db: Db): Promise<string | null> {
  let current: SavedProfile | undefined = latest;
  for (let attempt = 0; attempt < 3 && current; attempt++) {
    const existing = current[field] ?? [];
    if (existing.some((item) => item.toLowerCase() === term.toLowerCase())) return null;
    if (field === "topics") {
      try { await assertWithinCount(workspaceId, "keywords", 0, existing.length + 1, existing.length); }
      catch (error) {
        if (error instanceof PlanLimitError) return null;
        throw error;
      }
    }
    const [saved] = await db.insert(monitoringProfile).values({
      workspaceId, version: current.version + 1, productUrl: current.productUrl, docsUrls: current.docsUrls,
      productDescription: current.productDescription, targetCustomer: current.targetCustomer,
      competitors: field === "competitors" ? [...existing, term] : current.competitors,
      topics: field === "topics" ? [...existing, term] : current.topics,
      productMaterialStatus: current.productMaterialStatus, productMaterialText: current.productMaterialText, retrievalNotes: current.retrievalNotes,
    }).onConflictDoNothing().returning({ id: monitoringProfile.id });
    if (saved) return saved.id;
    current = await latestSavedProfile(workspaceId, db);
  }
  return null;
}

export async function decideCompetitor(workspaceId: string, id: string, decision: "accepted" | "rejected", db: Db = getDb()): Promise<Decision> {
  const latest = decision === "accepted" ? await latestSavedProfile(workspaceId, db) : undefined;
  if (decision === "accepted" && !latest) return { ok: false, reason: "profile_required" };
  const rows = await db.update(competitor).set({ status: decision, decidedAt: new Date() })
    .where(and(eq(competitor.workspaceId, workspaceId), eq(competitor.id, id), eq(competitor.status, "proposed")))
    .returning({ domain: competitor.domain });
  if (!rows[0]) return { ok: false };
  let profileId: string | null = null;
  try { profileId = latest ? await addTermToProfile(workspaceId, "competitors", rows[0].domain, latest, db) : null; }
  catch (error) {
    // Not saved, so hand the row back: otherwise a retry would be told it was already handled.
    await db.update(competitor).set({ status: "proposed", decidedAt: null })
      .where(and(eq(competitor.workspaceId, workspaceId), eq(competitor.id, id), eq(competitor.status, "accepted")));
    throw error;
  }
  return profileId ? { ok: true, value: rows[0].domain, profileId } : { ok: true, value: rows[0].domain };
}

export async function decideKeyword(workspaceId: string, id: string, decision: "accepted" | "rejected", db: Db = getDb()): Promise<Decision> {
  const latest = decision === "accepted" ? await latestSavedProfile(workspaceId, db) : undefined;
  if (decision === "accepted" && !latest) return { ok: false, reason: "profile_required" };
  const rows = await db.update(keywordRecommendation).set({ status: decision, decidedAt: new Date() })
    .where(and(eq(keywordRecommendation.workspaceId, workspaceId), eq(keywordRecommendation.id, id), eq(keywordRecommendation.status, "proposed")))
    .returning({ keyword: keywordRecommendation.keyword });
  if (!rows[0]) return { ok: false };
  let profileId: string | null = null;
  try { profileId = latest ? await addTermToProfile(workspaceId, "topics", rows[0].keyword, latest, db) : null; }
  catch (error) {
    // Not saved, so hand the row back: otherwise a retry would be told it was already handled.
    await db.update(keywordRecommendation).set({ status: "proposed", decidedAt: null })
      .where(and(eq(keywordRecommendation.workspaceId, workspaceId), eq(keywordRecommendation.id, id), eq(keywordRecommendation.status, "accepted")));
    throw error;
  }
  return profileId ? { ok: true, value: rows[0].keyword, profileId } : { ok: true, value: rows[0].keyword };
}

/**
 * Turns a term the owner accepted (a keyword, or a competitor's brand) into a Hacker News search proposal. It goes
 * through the same quality gate as an agent's proposal, so a generic accepted term is still rejected, with reasons.
 */
export async function queueTermSource(workspaceId: string, term: string, db: Db = getDb()): Promise<{ queued: boolean }> {
  const profile = await loadReviewProfile(workspaceId, db);
  if (!profile) return { queued: false };
  const proposal = {
    sourceType: "hn" as const, name: `Search (Hacker News): ${term}`, queries: [term],
    rationale: "You accepted this term, so Vantage searches Hacker News for it.", relevanceScore: 1,
  };
  const review = reviewSourceProposal(profile, proposal);
  await db.insert(sourceProposal).values({
    workspaceId, action: "add", sourceType: proposal.sourceType, name: proposal.name, queries: proposal.queries, rationale: proposal.rationale,
    modelScore: "1.00", relevanceScore: review.score.toFixed(2), accepted: review.accepted, reviewReasons: review.reasons, matchedTerms: review.matchedTerms,
    status: review.accepted ? "reviewed" : "rejected",
  }).onConflictDoNothing({ target: [sourceProposal.workspaceId, sourceProposal.name, sourceProposal.action] });
  return { queued: review.accepted };
}

type SourceRow = Pick<NewSource, "type" | "lane" | "config">;

/** The source row a reviewed proposal becomes, or null when it needs a provider the operator has not configured. */
function toSourceRow(type: string, queries: string[], providedEnv: Env): SourceRow | null {
  const env = providedEnv as NodeJS.ProcessEnv;
  // The same provider checks the collectors make, so a source is not left waiting while the collector could run it.
  if (type === "hn") return { type: "hn", lane: "free", config: { queries, maxPages: 1, enrich: false } };
  if (type === "reddit") {
    const ready = hasFirecrawlApiKey(env) || linkupLaneEnabled(env) || hasTinyFishApiKey(env) || hasScavioApiKey(env);
    return ready ? { type: "reddit", lane: "byok", config: { queries, limit: 10 } } : null;
  }
  if (type === "web_search") {
    return hasTinyFishApiKey(env) || hasFirecrawlApiKey(env)
      ? { type: "web_search", lane: "byok", config: { provider: WEB_DISCUSSIONS_PROVIDER, queries, kinds: ["forum", "blog"], maxResults: 10, lookbackHours: 168, excludeHosts: [] } }
      : null;
  }
  return null;
}

type ReviewedRow = typeof sourceProposal.$inferSelect;

/**
 * Automatic ingestion of sources the quality gate accepted. The review score is checked again here, so a row that was
 * edited or flagged by mistake still cannot become a source below the threshold. (The proposing model's own score is
 * not checked: when the AI review approved a source it ignored that score, and on the term-only path the gate has
 * already required it before `accepted` was set.) Sources are added inside the workspace scan lease, like every other
 * source mutation, so concurrent ingests cannot both pass the plan's source count and a scan cannot interleave.
 */
const reviewedRows = (workspaceId: string, db: Db) => db.select().from(sourceProposal)
  .where(and(eq(sourceProposal.workspaceId, workspaceId), eq(sourceProposal.action, "add"), eq(sourceProposal.accepted, true), eq(sourceProposal.status, "reviewed"))).limit(50);

export async function ingestReviewedSources(workspaceId: string, db: Db = getDb(), env: Env = process.env): Promise<{ ingested: string[]; waiting: string[] }> {
  const rows = await reviewedRows(workspaceId, db);
  if (rows.length === 0) return { ingested: [], waiting: [] };
  try {
    return await withWorkspaceScanLease(workspaceId, (signal) => addReviewedSources(workspaceId, rows, db, env, signal));
  } catch (error) {
    // A scan is running. The proposals stay reviewed and are picked up by the next ingest.
    if (error instanceof ScanLeaseBusyError) return { ingested: [], waiting: rows.map((row) => row.name) };
    throw error;
  }
}

/**
 * The scan's review step calls this while the scan already holds the workspace lease, so sources left waiting by an
 * ingest that found the lease busy are created on the next scan. Never call it without holding the lease.
 */
export async function ingestReviewedSourcesUnderScanLease(workspaceId: string, signal: AbortSignal, db: Db = getDb(), env: Env = process.env): Promise<{ ingested: string[]; waiting: string[] }> {
  const rows = await reviewedRows(workspaceId, db);
  if (rows.length === 0) return { ingested: [], waiting: [] };
  return addReviewedSources(workspaceId, rows, db, env, signal);
}

async function addReviewedSources(workspaceId: string, rows: ReviewedRow[], db: Db, env: Env, signal: AbortSignal): Promise<{ ingested: string[]; waiting: string[] }> {
  const existing = await db.select({ name: source.name }).from(source).where(eq(source.workspaceId, workspaceId)).limit(100);
  const names = new Set(existing.map((row) => row.name));
  const ingested: string[] = [];
  const waiting: string[] = [];
  let limitReached = false;
  const mark = (id: string, status: "ingested" | "rejected") => db.update(sourceProposal).set({ status, decidedAt: new Date() })
    .where(and(eq(sourceProposal.workspaceId, workspaceId), eq(sourceProposal.id, id)));

  for (const row of rows) {
    signal.throwIfAborted();
    if (Number(row.relevanceScore) < SOURCE_RELEVANCE_THRESHOLD) { await mark(row.id, "rejected"); continue; }
    if (names.has(row.name)) { await mark(row.id, "ingested"); continue; }
    const built = toSourceRow(row.sourceType, row.queries, env);
    if (!built || limitReached) { waiting.push(row.name); continue; }
    try { await assertWithinCount(workspaceId, "sources", names.size); }
    catch (error) {
      if (!(error instanceof PlanLimitError)) throw error;
      limitReached = true; waiting.push(row.name); continue;
    }
    await db.insert(source).values({ workspaceId, name: row.name, ...built }).onConflictDoNothing({ target: [source.workspaceId, source.name] });
    await mark(row.id, "ingested");
    names.add(row.name);
    ingested.push(row.name);
  }
  return { ingested, waiting };
}

/** The owner's answer to "this source keeps returning irrelevant documents". Accepting pauses it (the source row is kept, not deleted). */
export async function decideSourceRemoval(workspaceId: string, id: string, decision: "accepted" | "dismissed", db: Db = getDb()): Promise<{ ok: boolean }> {
  const [proposal] = await db.select().from(sourceProposal)
    .where(and(eq(sourceProposal.workspaceId, workspaceId), eq(sourceProposal.id, id), eq(sourceProposal.action, "remove"), eq(sourceProposal.status, "removal_proposed"))).limit(1);
  if (!proposal) return { ok: false };
  if (decision === "accepted" && proposal.sourceId) {
    await db.update(source).set({ health: "paused", updatedAt: new Date() })
      .where(and(eq(source.workspaceId, workspaceId), eq(source.id, proposal.sourceId)));
  }
  await db.update(sourceProposal).set({ status: decision === "accepted" ? "ingested" : "dismissed", decidedAt: new Date() })
    .where(and(eq(sourceProposal.workspaceId, workspaceId), eq(sourceProposal.id, id)));
  return { ok: true };
}
