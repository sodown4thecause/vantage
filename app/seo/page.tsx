import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";

import { PageHead, Shell } from "@/components/shell";
import { authorizeWorkspace, getCurrentWorkspace } from "@/lib/auth/workspace";
import { getLatestMonitoringProfile } from "@/lib/profile/repository";
import { getConversation, listConversations } from "@/lib/seo-agent/conversations";
import { seoModels } from "@/lib/seo-agent/models";
import { profileContext, starterChips, withCacheLabels } from "@/lib/seo-agent/suggestions";
import { ChatClient } from "./chat-client";

export const metadata: Metadata = { title: "SEO", robots: { index: false } };

export const dynamic = "force-dynamic";

const conversationIdSchema = z.uuid();

function seoHref(workspaceId: string, conversationId?: string): string {
  const search = new URLSearchParams({ workspaceId });
  if (conversationId) search.set("c", conversationId);
  return `/seo?${search.toString()}`;
}

export default async function SeoPage({
  searchParams,
}: {
  searchParams: Promise<{ workspaceId?: string; c?: string }>;
}) {
  const params = await searchParams;
  const workspaceId = params.workspaceId?.trim() || (await getCurrentWorkspace())?.id;

  if (!workspaceId) redirect("/");

  const authorization = await authorizeWorkspace(workspaceId);
  if (!authorization.ok) {
    return (
      <Shell workspaceId={workspaceId} active="seo">
        <p className="text-stop" role="alert">
          Unable to load this page.
        </p>
      </Shell>
    );
  }

  if (!seoModels()) {
    return (
      <Shell workspaceId={workspaceId} active="seo">
        <PageHead title="SEO" />
        <p className="text-ridge">SEO data is not set up yet.</p>
      </Shell>
    );
  }

  // A malformed or foreign id finds no conversation, so the page shows an empty chat rather than an error.
  const requested = params.c ? conversationIdSchema.safeParse(params.c.trim()) : null;
  const selectedId = requested?.success ? requested.data : null;
  const [conversations, selected, profile] = await Promise.all([
    listConversations(workspaceId),
    selectedId ? getConversation(workspaceId, selectedId) : null,
    getLatestMonitoringProfile(workspaceId),
  ]);

  const context = profileContext(profile);
  const starters = await withCacheLabels(starterChips(context), context);
  const sandbox = process.env.DATAFORSEO_ENV !== "live";

  return (
    <Shell workspaceId={workspaceId} active="seo" wide>
      <PageHead
        title="SEO"
        lede="Ask about search, AI answers and content. Every answer shows the data behind it, and paid lookups ask before they run."
      />
      <div className="grid gap-10 md:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="Conversations" className="space-y-4">
          <Link href={seoHref(workspaceId)} className="btn-quiet inline-block">
            New chat
          </Link>
          <ul className="space-y-1 text-sm">
            {conversations.map((conversation) => {
              const active = selected?.id === conversation.id;
              return (
                <li key={conversation.id}>
                  <Link
                    href={seoHref(workspaceId, conversation.id)}
                    aria-current={active ? "page" : undefined}
                    className={
                      "block truncate rounded px-2 py-1.5 transition-colors " +
                      (active ? "bg-ink text-paper" : "text-ridge hover:text-ink")
                    }
                  >
                    {conversation.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="min-w-0">
          {/* Keyed by conversation: a new chat, or a switch to another one, starts from the server's messages. */}
          <ChatClient
            key={selected?.id ?? "new"}
            workspaceId={workspaceId}
            conversationId={selected?.id ?? null}
            initialMessages={selected?.messages ?? []}
            starters={starters}
            sandbox={sandbox}
          />
        </div>
      </div>
    </Shell>
  );
}
