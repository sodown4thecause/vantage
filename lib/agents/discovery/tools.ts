import { createHash } from "node:crypto";
import { tool } from "ai";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { discoveryEvidence } from "@/lib/db/schema";
import { proposalActor, createStrategyProposal, getStrategyState } from "@/lib/gtm/proposals/repository";
import type { DiscoveryProposalContext } from "@/lib/gtm/chat/types";
import { researchProductSite } from "./research";
import { buildDiscoveryPlan, discoveryPlanSchema, normaliseDiscoveryPlan } from "./profile";
import { discoveryPlanToStrategyChange } from "./sources";
import type { ResearchEvidence } from "./types";

const evidenceIdList = z.array(z.uuid()).min(1).max(20).refine(ids => new Set(ids).size === ids.length, "Duplicate evidence ID");
const siteInput = z.strictObject({ url: z.string().url().max(2_000) });
const planInput = z.strictObject({ evidenceIds: evidenceIdList, ownerNotes: z.string().max(4_000).default("") });
const proposalInput = z.strictObject({ plan: discoveryPlanSchema, exclusions: z.array(z.string().trim().min(1).max(200)).max(100).optional() });

function budgetRequestId(requestId: string, toolCallId: string): string {
  return `d:${createHash("sha256").update(`${requestId}:${toolCallId}`).digest("hex")}`;
}

async function safe<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (error instanceof Error && error.message === "Discovery model unavailable.") throw new Error("Discovery is not configured; no workspace changes were made.");
    throw new Error("Discovery action unavailable; no workspace configuration was changed.");
  }
}

async function loadEvidence(workspaceId: string, ids: string[]): Promise<ResearchEvidence[]> {
  const rows = await getDb().select({
    id: discoveryEvidence.id, url: discoveryEvidence.url, retrievedAt: discoveryEvidence.retrievedAt,
    excerpt: discoveryEvidence.excerpt, provider: discoveryEvidence.provider, contentKind: discoveryEvidence.contentKind,
    status: discoveryEvidence.status,
  }).from(discoveryEvidence).where(and(eq(discoveryEvidence.workspaceId, workspaceId), inArray(discoveryEvidence.id, ids)));
  const requested = new Set(ids);
  if (rows.length !== ids.length || rows.some(row => !requested.has(row.id))) throw new Error("Evidence is unavailable in this workspace.");
  return rows.map(row => ({ ...row, retrievedAt: row.retrievedAt.toISOString() }));
}

export function discoveryTools(context: { workspaceId: string; conversationId: string; requestId: string; signal: AbortSignal }) {
  return {
    research_product_site: tool({
      description: "Read one public product or competitor page using the bounded discovery budget. Returns dated evidence or explicit gaps. This does not change workspace configuration.",
      inputSchema: siteInput,
      execute: async ({ url }, options) => safe(async () => {
        context.signal.throwIfAborted();
        await proposalActor(context.workspaceId);
        const result = await researchProductSite({ workspaceId: context.workspaceId, url, requestId: budgetRequestId(context.requestId, options.toolCallId), signal: context.signal });
        return { evidence: result.evidence, unknowns: result.unknowns, changedConfiguration: false };
      }),
    }),
    build_discovery_plan: tool({
      description: "Build a strict, evidence-cited plan from saved verified pages in this workspace. Cite only the returned evidence IDs. No configuration is written.",
      inputSchema: planInput,
      execute: async ({ evidenceIds, ownerNotes }, options) => safe(async () => {
        context.signal.throwIfAborted();
        await proposalActor(context.workspaceId);
        const evidence = await loadEvidence(context.workspaceId, evidenceIds);
        const plan = await buildDiscoveryPlan({ workspaceId: context.workspaceId, evidence, ownerNotes, signal: context.signal, requestId: budgetRequestId(context.requestId, options.toolCallId) });
        return { plan, changedConfiguration: false };
      }),
    }),
    propose_discovery_plan: tool({
      description: "Create a pending exact-diff strategy proposal from the cited plan and any owner-requested exclusions. This never applies configuration or starts a scan; the owner must explicitly confirm this exact proposal.",
      inputSchema: proposalInput,
      execute: async ({ plan: candidate, exclusions }) => safe(async () => {
        context.signal.throwIfAborted();
        await proposalActor(context.workspaceId);
        const ids = [...new Set([
          ...candidate.profile.evidenceIds,
          ...candidate.competitors.flatMap(row => row.evidenceIds),
          ...candidate.keywords.flatMap(row => row.evidenceIds),
          ...candidate.sources.flatMap(row => row.evidenceIds),
        ])];
        const evidence = await loadEvidence(context.workspaceId, ids);
        const plan = normaliseDiscoveryPlan(candidate, evidence);
        const state = await getStrategyState({ workspaceId: context.workspaceId, conversationId: context.conversationId });
        const current = state.profile ? {
          productUrl: state.profile.productUrl,
          productDescription: state.profile.productDescription,
          targetCustomer: state.profile.targetCustomer,
          competitors: state.profile.competitors,
          topics: state.profile.topics,
        } : null;
        const payload = discoveryPlanToStrategyChange(plan, { currentProfile: current, exclusions });
        const proposal = await createStrategyProposal({
          workspaceId: context.workspaceId,
          conversationId: context.conversationId,
          strategyVersion: state.strategyVersion,
          payload,
        });
        const selectedIds = new Set(ids);
        const citedEvidence = evidence.filter(row => selectedIds.has(row.id)).map(row => ({
          id: row.id, url: row.url, retrievedAt: row.retrievedAt, excerpt: row.excerpt.slice(0, 500),
          provider: row.provider, contentKind: row.contentKind, status: row.status,
        }));
        const discovery: DiscoveryProposalContext = {
          plan,
          evidence: citedEvidence,
          unknowns: plan.unknowns,
          cadence: { kind: "manual_only", recurring: false, note: "No recurring scan schedule is proposed. Sources are proposed paused; scanning still requires the explicit workspace scan control." },
          cost: { estimateUsd: null, note: "Discovery did not calculate future scan/provider costs. Existing workspace and provider caps still apply; no scan was started." },
        };
        return { ...proposal, discovery };
      }),
    }),
  };
}
