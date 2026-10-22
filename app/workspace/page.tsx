import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { z } from "zod";

import { ScanButton } from "@/app/source-controls";
import { Shell } from "@/components/shell";
import { authorizeWorkspace, getCurrentWorkspace } from "@/lib/auth/workspace";
import { nextStep, promptFor } from "@/lib/onboarding/interview";
import { findResumableInterview } from "@/lib/onboarding/interview-store";
import { getOpportunityDetail, listOpportunityQueue } from "@/lib/opportunities/run";
import type { OpportunityDetailView } from "@/lib/opportunities/types";
import { getLatestMonitoringProfile } from "@/lib/profile/repository";
import { getConversation } from "@/lib/seo-agent/conversations";
import { seoModels } from "@/lib/seo-agent/model-config";
import { parseBlocks } from "@/lib/workspace/blocks";
import { listSavedArtifacts, type SavedArtifactView } from "@/lib/workspace/saved-artifacts";

import { WorkspaceClient, type InterviewStart, type NextAction, type Turn } from "./workspace-client";

export const metadata: Metadata = { title: "GTM workspace", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Saved items are secondary: a failure here (for example before the migration is applied) never blocks the page. */
async function savedOrEmpty(workspaceId: string): Promise<SavedArtifactView[]> {
  try {
    return await listSavedArtifacts(workspaceId);
  } catch (error) {
    console.error("[workspace page] saved artifacts unavailable", { error: error instanceof Error ? error.name : "unknown" });
    return [];
  }
}

export default async function WorkspacePage({ searchParams }: { searchParams: Promise<{ workspaceId?: string; c?: string; setup?: string }> }) {
  const params = await searchParams;
  const workspaceId = params.workspaceId?.trim() || (await getCurrentWorkspace())?.id;
  if (!workspaceId) redirect("/");
  const authorization = await authorizeWorkspace(workspaceId);
  if (!authorization.ok) return <Shell><p role="alert" className="text-stop">Unable to load this workspace.</p></Shell>;

  const requested = z.uuid().safeParse(params.c);
  const [profile, queue, conversation, resumable, saved] = await Promise.all([
    getLatestMonitoringProfile(workspaceId),
    listOpportunityQueue({ workspaceId, limit: 5 }),
    requested.success ? getConversation(workspaceId, requested.data) : null,
    findResumableInterview(workspaceId),
    savedOrEmpty(workspaceId),
  ]);
  const details = await Promise.all(queue.map((item) => getOpportunityDetail({ workspaceId, opportunityId: item.id })));
  const evidence = details.filter((item): item is OpportunityDetailView => item !== null);
  const gtmConversation = conversation?.messages.some((message) => message.parts.cards?.some((card) => card.tool === "gtm_journey")) ? conversation : null;
  const turns: Turn[] = (gtmConversation?.messages ?? []).map((message) => {
    const journey = message.parts.cards?.find((card) => card.tool === "gtm_journey")?.data as { actions?: NextAction[]; evidence?: OpportunityDetailView[]; blocks?: unknown } | undefined;
    return { role: message.role, content: message.content, actions: journey?.actions, evidence: journey?.evidence, blocks: parseBlocks(journey?.blocks) };
  });
  // Resume an unfinished interview at its next unanswered question; otherwise start fresh, offering the current answers.
  const answers = resumable?.state.answers ?? {};
  const step = resumable ? nextStep(answers) : "productUrl";
  const interview: InterviewStart = {
    conversationId: resumable?.id ?? null,
    prompt: step ? promptFor(step, answers, profile) : undefined,
    turns: resumable?.turns ?? [],
  };
  let productName = "Your product";
  if (profile?.productUrl) {
    try { productName = new URL(profile.productUrl).hostname.replace(/^www\./, ""); } catch { productName = "Your product"; }
  }
  return <WorkspaceClient key={gtmConversation?.id ?? "new"} workspaceId={workspaceId} productName={productName} hasProfile={Boolean(profile)} initialEvidence={evidence} initialTurns={turns} initialConversationId={gtmConversation?.id ?? null} configured={seoModels() !== null} scanControl={<ScanButton workspaceId={workspaceId} />}
    interview={interview} interviewOpen={params.setup === "1" && !gtmConversation} savedArtifacts={saved} />;
}
