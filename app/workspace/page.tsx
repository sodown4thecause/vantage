import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { z } from "zod";

import { ScanButton } from "@/app/source-controls";
import { Shell } from "@/components/shell";
import { authorizeWorkspace, getCurrentWorkspace } from "@/lib/auth/workspace";
import { getOpportunityDetail, listOpportunityQueue } from "@/lib/opportunities/run";
import type { OpportunityDetailView } from "@/lib/opportunities/types";
import { getLatestMonitoringProfile } from "@/lib/profile/repository";
import { getConversation } from "@/lib/seo-agent/conversations";
import { seoModels } from "@/lib/seo-agent/model-config";

import { WorkspaceClient, type NextAction, type Turn } from "./workspace-client";

export const metadata: Metadata = { title: "GTM workspace", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function WorkspacePage({ searchParams }: { searchParams: Promise<{ workspaceId?: string; c?: string }> }) {
  const params = await searchParams;
  const workspaceId = params.workspaceId?.trim() || (await getCurrentWorkspace())?.id;
  if (!workspaceId) redirect("/");
  const authorization = await authorizeWorkspace(workspaceId);
  if (!authorization.ok) return <Shell><p role="alert" className="text-stop">Unable to load this workspace.</p></Shell>;

  const requested = z.uuid().safeParse(params.c);
  const [profile, queue, conversation] = await Promise.all([
    getLatestMonitoringProfile(workspaceId),
    listOpportunityQueue({ workspaceId, limit: 5 }),
    requested.success ? getConversation(workspaceId, requested.data) : null,
  ]);
  const details = await Promise.all(queue.map((item) => getOpportunityDetail({ workspaceId, opportunityId: item.id })));
  const evidence = details.filter((item): item is OpportunityDetailView => item !== null);
  const gtmConversation = conversation?.messages.some((message) => message.parts.cards?.some((card) => card.tool === "gtm_journey")) ? conversation : null;
  const turns: Turn[] = (gtmConversation?.messages ?? []).map((message) => {
    const journey = message.parts.cards?.find((card) => card.tool === "gtm_journey")?.data as { actions?: NextAction[]; evidence?: OpportunityDetailView[] } | undefined;
    return { role: message.role, content: message.content, actions: journey?.actions, evidence: journey?.evidence };
  });
  let productName = "Your product";
  if (profile?.productUrl) {
    try { productName = new URL(profile.productUrl).hostname.replace(/^www\./, ""); } catch { productName = "Your product"; }
  }
  return <WorkspaceClient key={gtmConversation?.id ?? "new"} workspaceId={workspaceId} productName={productName} hasProfile={Boolean(profile)} initialEvidence={evidence} initialTurns={turns} initialConversationId={gtmConversation?.id ?? null} configured={seoModels() !== null} scanControl={<ScanButton workspaceId={workspaceId} />} />;
}
