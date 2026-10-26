import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { z } from "zod";

import { PageHead, Shell } from "@/components/shell";
import { authorizeWorkspace, getCurrentWorkspace } from "@/lib/auth/workspace";
import { getContentBrandVoiceProfile, getContentThread, listContentDrafts, listContentThreads } from "@/lib/content-agent/repository";
import { listOpportunityQueue } from "@/lib/opportunities/run";
import { getLatestMonitoringProfile } from "@/lib/profile/repository";

import { ContentWorkspaceClient } from "./content-workspace-client";
import { buildSuggestedPrompts } from "./suggested-prompts";

export const metadata: Metadata = { title: "Content", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function ContentPage({ searchParams }: { searchParams: Promise<{ workspaceId?: string; threadId?: string }> }) {
  const params = await searchParams;
  const workspaceId = params.workspaceId?.trim() || (await getCurrentWorkspace())?.id;
  if (!workspaceId) redirect("/");
  const authorization = await authorizeWorkspace(workspaceId);
  if (!authorization.ok) return <Shell><p role="alert" className="text-stop">Unable to load this workspace.</p></Shell>;

  const requestedThreadId = z.uuid().safeParse(params.threadId?.trim());
  const selected = requestedThreadId.success ? await getContentThread(workspaceId, requestedThreadId.data) : null;
  const [threads, drafts, brandVoiceProfile, opportunities, keywordProfile] = await Promise.all([
    listContentThreads(workspaceId),
    listContentDrafts(workspaceId, 6),
    getContentBrandVoiceProfile(workspaceId),
    listOpportunityQueue({ workspaceId, limit: 3 }),
    getLatestMonitoringProfile(workspaceId),
  ]);
  const suggestedPrompts = buildSuggestedPrompts({ workspaceId, opportunities, profile: keywordProfile });

  return <Shell workspaceId={workspaceId} active="content" wide>
    <PageHead
      title="Make something useful from what you know."
      lede="Talk through an idea, shape it into a draft, and decide what to do with it. Vantage helps you write; nothing is published for you."
    />
    <ContentWorkspaceClient
      key={`${workspaceId}:${selected?.thread.id ?? "new"}`}
      workspaceId={workspaceId}
      selectedThreadId={selected?.thread.id ?? null}
      initialMessages={selected?.messages ?? []}
      threads={threads}
      drafts={drafts}
      brandVoiceProfile={brandVoiceProfile}
      suggestedPrompts={suggestedPrompts}
    />
  </Shell>;
}
