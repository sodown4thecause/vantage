import { and, asc, desc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { seoConversation, seoMessage } from "@/lib/db/schema";

export type SeoMessageRole = "user" | "assistant";
export type SeoMessageStatus = "complete" | "incomplete" | "needs_approval" | "approved";

/** One tool result shown as a card. `data` is provider output: untrusted, render as text only. */
export type ResultCard = {
  tool: string;
  title: string;
  fetchedAt: string | null;
  cached: boolean;
  data: unknown;
  /** True when the data came from the DataForSEO sandbox. Older cards have no value; the page's environment applies. */
  sandbox?: boolean;
};

export type FollowUps = { seo: string; geo: string; content: string };

/** A paid tool call the owner must approve before it runs. */
export type PlannedCall = {
  tool: string;
  input: Record<string, unknown>;
  credits: number;
};

export type SeoMessageParts = {
  cards?: ResultCard[];
  followUps?: FollowUps;
  plan?: PlannedCall[];
  notices?: string[];
};

/** A stored message as the agent and the chat page read it. Dates are ISO strings. */
export type SeoMessageRow = {
  id: string;
  role: SeoMessageRole;
  content: string;
  parts: SeoMessageParts;
  status: SeoMessageStatus;
  creditsUsed: number;
  createdAt: string;
};

/** Thrown when the conversation does not exist in the given workspace. */
export class ConversationNotFoundError extends Error {
  constructor() {
    super("conversation not found");
    this.name = "ConversationNotFoundError";
  }
}

export async function createConversation(workspaceId: string, title: string): Promise<{ id: string }> {
  const [row] = await getDb()
    .insert(seoConversation)
    .values({ workspaceId, title })
    .returning({ id: seoConversation.id });
  return { id: row!.id };
}

export async function listConversations(
  workspaceId: string,
  limit = 30,
): Promise<{ id: string; title: string; updatedAt: string }[]> {
  const rows = await getDb()
    .select({ id: seoConversation.id, title: seoConversation.title, updatedAt: seoConversation.updatedAt })
    .from(seoConversation)
    .where(eq(seoConversation.workspaceId, workspaceId))
    .orderBy(desc(seoConversation.updatedAt))
    .limit(limit);
  return rows.map((row) => ({ id: row.id, title: row.title, updatedAt: row.updatedAt.toISOString() }));
}

export async function getConversation(
  workspaceId: string,
  conversationId: string,
): Promise<{ id: string; title: string; messages: SeoMessageRow[] } | null> {
  const db = getDb();
  const [conversation] = await db
    .select({ id: seoConversation.id, title: seoConversation.title })
    .from(seoConversation)
    .where(and(eq(seoConversation.id, conversationId), eq(seoConversation.workspaceId, workspaceId)))
    .limit(1);
  if (!conversation) return null;

  const rows = await db
    .select()
    .from(seoMessage)
    .where(and(eq(seoMessage.conversationId, conversationId), eq(seoMessage.workspaceId, workspaceId)))
    .orderBy(asc(seoMessage.createdAt));
  return {
    id: conversation.id,
    title: conversation.title,
    messages: rows.map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      parts: row.parts,
      status: row.status,
      creditsUsed: row.creditsUsed,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

/**
 * Appends a message and bumps the conversation's updated_at. The conversation is checked against
 * the workspace first (neon-http has no transactions); its workspace_id never changes, so the
 * check cannot go stale. The insert and the bump then run in one batch.
 */
export async function appendMessage(
  workspaceId: string,
  conversationId: string,
  msg: {
    /** Set when the caller needs the row's id before it saves (the run names its message in the stream). */
    id?: string;
    role: SeoMessageRole;
    content: string;
    parts?: SeoMessageParts;
    status?: SeoMessageStatus;
    creditsUsed?: number;
  },
): Promise<{ id: string }> {
  const db = getDb();
  const [owned] = await db
    .select({ id: seoConversation.id })
    .from(seoConversation)
    .where(and(eq(seoConversation.id, conversationId), eq(seoConversation.workspaceId, workspaceId)))
    .limit(1);
  if (!owned) throw new ConversationNotFoundError();

  const [inserted] = await db.batch([
    db
      .insert(seoMessage)
      .values({
        ...(msg.id ? { id: msg.id } : {}),
        workspaceId,
        conversationId,
        role: msg.role,
        content: msg.content,
        parts: msg.parts ?? {},
        status: msg.status ?? "complete",
        creditsUsed: msg.creditsUsed ?? 0,
      })
      .returning({ id: seoMessage.id }),
    db
      .update(seoConversation)
      .set({ updatedAt: new Date() })
      .where(and(eq(seoConversation.id, conversationId), eq(seoConversation.workspaceId, workspaceId))),
  ]);
  return { id: inserted![0]!.id };
}

/**
 * Atomically moves a plan from `needs_approval` to `approved`. Returns the planned calls when this
 * call made the transition, or null when the message is missing, belongs to another workspace, or
 * was already claimed. The single conditional UPDATE is what prevents a double charge.
 */
export async function claimPlan(workspaceId: string, messageId: string): Promise<PlannedCall[] | null> {
  const [row] = await getDb()
    .update(seoMessage)
    .set({ status: "approved" })
    .where(
      and(
        eq(seoMessage.id, messageId),
        eq(seoMessage.workspaceId, workspaceId),
        eq(seoMessage.status, "needs_approval"),
      ),
    )
    .returning({ parts: seoMessage.parts });
  if (!row) return null;
  return row.parts.plan ?? [];
}

/**
 * Returns an approved plan to `needs_approval` when its run produced no answer, so the owner can run it again. One
 * conditional UPDATE: only a message that is still `approved` in this workspace changes. Returns whether it did.
 */
export async function unclaimPlan(workspaceId: string, messageId: string): Promise<boolean> {
  const rows = await getDb()
    .update(seoMessage)
    .set({ status: "needs_approval" })
    .where(
      and(
        eq(seoMessage.id, messageId),
        eq(seoMessage.workspaceId, workspaceId),
        eq(seoMessage.status, "approved"),
      ),
    )
    .returning({ id: seoMessage.id });
  return rows.length > 0;
}
