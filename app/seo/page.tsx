import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";

import { WorkspaceFrame } from "@/components/workspace-frame";
import { authorizeWorkspace, getCurrentWorkspace } from "@/lib/auth/workspace";
import { dataForSeoConfig } from "@/lib/dataforseo/config";
import { getLatestMonitoringProfile } from "@/lib/profile/repository";
import { getConversation, listConversations } from "@/lib/seo-agent/conversations";
import { isResearchConversation } from "@/lib/seo-agent/conversation-lane";
import { seoModels } from "@/lib/seo-agent/models";
import { profileContext, starterChips, withCacheLabels } from "@/lib/seo-agent/suggestions";
import { ChatClient } from "./chat-client";

export const metadata: Metadata = { title: "SEO", robots: { index: false } };

export const dynamic = "force-dynamic";

const conversationIdSchema = z.uuid();

function seoHref(workspaceId: string, conversationId?: string, focus: "seo" | "geo" = "seo"): string {
  const search = new URLSearchParams({ workspaceId });
  if (conversationId) search.set("c", conversationId);
  if (focus === "geo") search.set("focus", focus);
  return `/seo?${search.toString()}`;
}

export default async function SeoPage({
  searchParams,
}: {
  searchParams: Promise<{ workspaceId?: string; c?: string; focus?: string }>;
}) {
  const params = await searchParams;
  const focus = params.focus === "geo" ? "geo" : "seo";
  const workspaceId = params.workspaceId?.trim() || (await getCurrentWorkspace())?.id;

  if (!workspaceId) redirect("/");

  const authorization = await authorizeWorkspace(workspaceId);
  if (!authorization.ok) {
    return (
      <WorkspaceFrame workspaceId={workspaceId} active={focus}>
        <p className="text-stop" role="alert">
          Unable to load this page.
        </p>
      </WorkspaceFrame>
    );
  }

  if (!seoModels()) {
    return (
      <WorkspaceFrame workspaceId={workspaceId} active={focus} title={focus === "geo" ? "GEO research" : "SEO research"}>
        <p className="text-ridge">SEO data is not set up yet.</p>
      </WorkspaceFrame>
    );
  }

  // A malformed or foreign id finds no conversation, so the page shows an empty chat rather than an error.
  const requested = params.c ? conversationIdSchema.safeParse(params.c.trim()) : null;
  const selectedId = requested?.success ? requested.data : null;
  const [conversations, candidate, profile] = await Promise.all([
    listConversations(workspaceId, 30, "research"),
    selectedId ? getConversation(workspaceId, selectedId) : null,
    getLatestMonitoringProfile(workspaceId),
  ]);
  const selected = candidate && isResearchConversation(candidate) ? candidate : null;

  const context = profileContext(profile);
  const starters = await withCacheLabels(starterChips(context, new Date(), undefined, focus), context);
  const sandbox = dataForSeoConfig()?.env !== "live";

  return (
    <WorkspaceFrame workspaceId={workspaceId} active={focus} focused title={focus === "geo" ? "GEO research" : "SEO research"}
      tools={<nav aria-label="Research conversations">
        <Link href={seoHref(workspaceId, undefined, focus)}>＋ New research conversation</Link>
        {conversations.map((conversation) => <Link
          key={conversation.id}
          href={seoHref(workspaceId, conversation.id, focus)}
          aria-current={selected?.id === conversation.id ? "page" : undefined}
          className={selected?.id === conversation.id ? "bg-sheet-2 text-ink" : "text-ridge hover:text-ink"}
        ><span className="min-w-0 truncate">{conversation.title}</span></Link>)}
      </nav>}>
      <ChatClient
        key={selected?.id ?? "new"}
        workspaceId={workspaceId}
        conversationId={selected?.id ?? null}
        initialMessages={selected?.messages ?? []}
        starters={starters}
        sandbox={sandbox}
        focus={focus}
      />
    </WorkspaceFrame>
  );
}
