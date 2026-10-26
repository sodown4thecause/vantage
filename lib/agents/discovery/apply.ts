import { and, desc, eq } from "drizzle-orm";

import { reviewSourceProposal, SOURCE_RELEVANCE_THRESHOLD } from "@/lib/agents/discovery/relevance";
import { loadReviewProfile } from "@/lib/agents/discovery/profile";
import { WEB_DISCUSSIONS_PROVIDER } from "@/lib/collectors/web-provider";
import { getDb } from "@/lib/db/client";
import { competitor, keywordRecommendation, monitoringProfile, proposedProfile, source, sourceProposal, type NewSource } from "@/lib/db/schema";
import { assertWithinCount } from "@/lib/plans/limits";
import { PlanLimitError } from "@/lib/plans/types";

/*
 * Applying proposals. Each function here is called only after the caller has authorised the workspace (the server
 * actions and the discovery route do that), and every statement is scoped by workspace id. Agents never import this
 * file. Nothing here fetches a site: the profile text was read by the agent through Linkup.
 */

type Db = ReturnType<typeof getDb>;
type Env = Record<string, string | undefined>;
export type Decision = { ok: true; value?: string } | { ok: false };

/** Saves the confirmed proposal as the workspace's next monitoring profile version. */
export async function confirmProfileProposal(workspaceId: string, proposalId: string, db: Db = getDb()): Promise<{ ok: true; version: number; profileId: string } | { ok: false }> {
  const [proposal] = await db.select().from(proposedProfile)
    .where(and(eq(proposedProfile.workspaceId, workspaceId), eq(proposedProfile.id, proposalId), eq(proposedProfile.status, "proposed"))).limit(1);
  if (!proposal) return { ok: false };
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
  await db.update(proposedProfile).set({ status: "accepted", decidedAt: new Date() })
    .where(and(eq(proposedProfile.workspaceId, workspaceId), eq(proposedProfile.id, proposalId)));
  return { ok: true, version, profileId: saved.id };
}

export async function decideCompetitor(workspaceId: string, id: string, decision: "accepted" | "rejected", db: Db = getDb()): Promise<Decision> {
  const rows = await db.update(competitor).set({ status: decision, decidedAt: new Date() })
    .where(and(eq(competitor.workspaceId, workspaceId), eq(competitor.id, id), eq(competitor.status, "proposed")))
    .returning({ domain: competitor.domain });
  return rows[0] ? { ok: true, value: rows[0].domain } : { ok: false };
}

export async function decideKeyword(workspaceId: string, id: string, decision: "accepted" | "rejected", db: Db = getDb()): Promise<Decision> {
  const rows = await db.update(keywordRecommendation).set({ status: decision, decidedAt: new Date() })
    .where(and(eq(keywordRecommendation.workspaceId, workspaceId), eq(keywordRecommendation.id, id), eq(keywordRecommendation.status, "proposed")))
    .returning({ keyword: keywordRecommendation.keyword });
  return rows[0] ? { ok: true, value: rows[0].keyword } : { ok: false };
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
function toSourceRow(type: string, queries: string[], env: Env): SourceRow | null {
  const tinyFish = Boolean(env.TINYFISH_API_KEY?.trim());
  if (type === "hn") return { type: "hn", lane: "free", config: { queries, maxPages: 1, enrich: false } };
  if (type === "reddit") return tinyFish || env.SCAVIO_API_KEY?.trim() ? { type: "reddit", lane: "byok", config: { queries, limit: 10 } } : null;
  if (type === "web_search") {
    return tinyFish || env.FIRECRAWL_API_KEY?.trim()
      ? { type: "web_search", lane: "byok", config: { provider: WEB_DISCUSSIONS_PROVIDER, queries, kinds: ["forum", "blog"], maxResults: 10, lookbackHours: 168, excludeHosts: [] } }
      : null;
  }
  return null;
}

/**
 * Automatic ingestion of sources the quality gate accepted. The scores are checked again here, so a row that was
 * edited or flagged by mistake still cannot become a source below the threshold.
 */
export async function ingestReviewedSources(workspaceId: string, db: Db = getDb(), env: Env = process.env): Promise<{ ingested: string[]; waiting: string[] }> {
  const rows = await db.select().from(sourceProposal)
    .where(and(eq(sourceProposal.workspaceId, workspaceId), eq(sourceProposal.action, "add"), eq(sourceProposal.accepted, true), eq(sourceProposal.status, "reviewed"))).limit(50);
  const existing = await db.select({ name: source.name }).from(source).where(eq(source.workspaceId, workspaceId)).limit(100);
  const names = new Set(existing.map((row) => row.name));
  const ingested: string[] = [];
  const waiting: string[] = [];
  let limitReached = false;
  const mark = (id: string, status: "ingested" | "rejected") => db.update(sourceProposal).set({ status, decidedAt: new Date() })
    .where(and(eq(sourceProposal.workspaceId, workspaceId), eq(sourceProposal.id, id)));

  for (const row of rows) {
    if (Number(row.relevanceScore) < SOURCE_RELEVANCE_THRESHOLD || Number(row.modelScore) < SOURCE_RELEVANCE_THRESHOLD) { await mark(row.id, "rejected"); continue; }
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

/** The owner's answer to "this source keeps returning irrelevant documents". Accepting pauses it, which they can undo. */
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
