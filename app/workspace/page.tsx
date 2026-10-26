import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";

import { ScanButton } from "@/app/source-controls";
import { Shell } from "@/components/shell";
import { authorizeWorkspace, getCurrentWorkspace } from "@/lib/auth/workspace";
import { getOpportunityDetail, listOpportunityQueue } from "@/lib/opportunities/run";
import type { OpportunityDetailView } from "@/lib/opportunities/types";
import { getLatestMonitoringProfile } from "@/lib/profile/repository";
import { getConversation, listConversations } from "@/lib/seo-agent/conversations";
import { seoModels } from "@/lib/seo-agent/model-config";
import { getGtmTurnStatus, loadGtmChat } from "@/lib/gtm/chat/store";
import { GtmChatLimitError } from "@/lib/gtm/chat/types";
import { getGtmConversationJobs } from "@/lib/gtm/chat/jobs";
import { getPendingStrategyProposal } from "@/lib/gtm/proposals/repository";
import { listSavedArtifacts, type SavedArtifactView } from "@/lib/workspace/saved-artifacts";

import { WorkspaceClient } from "./workspace-client";

export const metadata: Metadata = { title: "GTM workspace", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Saved items are secondary: a failure here (for example before the migration is applied) never blocks the page. */
async function savedOrEmpty(workspaceId: string): Promise<SavedArtifactView[]> {
  try {
    return await listSavedArtifacts(workspaceId);
  } catch {
    console.error("[workspace page] saved artifacts unavailable", { step: "saved_artifacts", category: "unexpected" });
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
  const [profile, queue, conversation, saved, conversations] = await Promise.all([
    getLatestMonitoringProfile(workspaceId),
    listOpportunityQueue({ workspaceId, limit: 5 }),
    requested.success ? getConversation(workspaceId, requested.data, "gtm") : null,
    savedOrEmpty(workspaceId),
    listConversations(workspaceId, 30, "gtm"),
  ]);
  const details = await Promise.all(queue.map((item) => getOpportunityDetail({ workspaceId, opportunityId: item.id })));
  const evidence = details.filter((item): item is OpportunityDetailView => item !== null);
  let chat = { messages: [] as Awaited<ReturnType<typeof loadGtmChat>>["messages"], revision: 0 };
  if (conversation) {
    try { chat = await loadGtmChat({ workspaceId, conversationId: conversation.id }); }
    catch (error) {
      if (!(error instanceof GtmChatLimitError)) throw error;
      return <Shell workspaceId={workspaceId} active="workspace">
        <section role="alert"><h1>Conversation history is too large to open</h1>
          <p>Your earlier conversation remains saved. Start a new conversation to continue.</p>
          <Link href={`/workspace?workspaceId=${encodeURIComponent(workspaceId)}`}>New conversation</Link>
        </section>
        <section aria-label="Confirmed strategy"><h2>Confirmed strategy</h2>
          {profile ? <><p>{profile.productDescription}</p><p>Audience: {profile.targetCustomer}</p><p>Topics: {profile.topics?.join(", ")}</p></> : <p>No confirmed product profile yet.</p>}
        </section>
        <nav aria-label="Saved conversations"><h2>Saved conversations</h2>
          {conversations.map(item => <Link key={item.id} href={`/workspace?workspaceId=${encodeURIComponent(workspaceId)}&c=${encodeURIComponent(item.id)}`}>{item.title}</Link>)}
        </nav>
      </Shell>;
    }
  }
  const turn = conversation ? await getGtmTurnStatus({ workspaceId, conversationId: conversation.id }) : null;
  const jobs = conversation ? await getGtmConversationJobs({ workspaceId, conversationId: conversation.id }) : [];
  const proposal = conversation ? await getPendingStrategyProposal({ workspaceId, conversationId: conversation.id }) : null;
  let productName = "Your product";
  if (profile?.productUrl) {
    try { productName = new URL(profile.productUrl).hostname.replace(/^www\./, ""); } catch { productName = "Your product"; }
  }
  return <WorkspaceClient key={conversation?.id ?? "new"} workspaceId={workspaceId} productName={productName} hasProfile={Boolean(profile)} profile={profile} initialEvidence={evidence} initialMessages={chat.messages} initialRevision={chat.revision} initialConversationId={conversation?.id ?? null} configured={seoModels() !== null} scanControl={<ScanButton workspaceId={workspaceId} />}
    initialTurn={turn} initialJobs={jobs} initialProposal={proposal} setupOpen={params.setup === "1"} savedArtifacts={saved} conversations={conversations} />;
}
