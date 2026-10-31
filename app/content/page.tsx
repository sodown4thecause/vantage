import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { z } from "zod";

import { PageHead, Shell } from "@/components/shell";
import { authorizeWorkspace, getCurrentWorkspace } from "@/lib/auth/workspace";
import { getContentBrandVoiceProfile, getContentThread, listContentDrafts, listContentDraftsForThread, listContentThreads } from "@/lib/content-agent/repository";
import { getContentSuggestedPrompts } from "@/lib/content-agent/suggested-prompts";

import { ContentLibrary } from "./content-library";
import { ContentWorkspaceClient } from "./content-workspace-client";

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
  const [threads, drafts, threadDrafts, brandVoiceProfile, suggestedPrompts] = await Promise.all([
    listContentThreads(workspaceId),
    listContentDrafts(workspaceId),
    selected ? listContentDraftsForThread(workspaceId, selected.thread.id) : Promise.resolve([]),
    getContentBrandVoiceProfile(workspaceId),
    getContentSuggestedPrompts(workspaceId),
  ]);

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
      drafts={drafts.slice(0, 6)}
      threadDrafts={threadDrafts}
      brandVoiceProfile={brandVoiceProfile}
      suggestedPrompts={suggestedPrompts}
    />
    <ContentLibrary key={workspaceId} workspaceId={workspaceId} initialDrafts={drafts} />
  </Shell>;
}
