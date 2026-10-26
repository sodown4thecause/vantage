import { and, asc, desc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { contentDraft, contentMessage, contentThread } from "@/lib/db/schema";
import type { ContentDraftInput, ContentMessageRole, ContentMessageStatus } from "./contracts";
import { contentThreadTitle } from "./contracts";

export type ContentThreadRow = typeof contentThread.$inferSelect;
export type ContentMessageRow = typeof contentMessage.$inferSelect;
export type ContentDraftRow = typeof contentDraft.$inferSelect;

export async function createContentThread(workspaceId: string, prompt: string): Promise<ContentThreadRow> {
  const [thread] = await getDb().insert(contentThread).values({
    workspaceId,
    title: contentThreadTitle(prompt),
  }).returning();
  if (!thread) throw new Error("Content thread could not be created.");
  return thread;
}

export async function listContentThreads(workspaceId: string, limit = 20): Promise<ContentThreadRow[]> {
  return getDb().select().from(contentThread)
    .where(eq(contentThread.workspaceId, workspaceId))
    .orderBy(desc(contentThread.updatedAt))
    .limit(limit);
}

/** A thread is visible only when both its id and its owner workspace match. */
export async function getContentThread(workspaceId: string, threadId: string): Promise<{
  thread: ContentThreadRow;
  messages: ContentMessageRow[];
} | null> {
  const [thread] = await getDb().select().from(contentThread)
    .where(and(eq(contentThread.workspaceId, workspaceId), eq(contentThread.id, threadId)))
    .limit(1);
  if (!thread) return null;
  const messages = await getDb().select().from(contentMessage)
    .where(and(eq(contentMessage.workspaceId, workspaceId), eq(contentMessage.threadId, threadId)))
    .orderBy(asc(contentMessage.createdAt));
  return { thread, messages };
}

export async function appendContentMessage(args: {
  workspaceId: string;
  threadId: string;
  role: ContentMessageRole;
  content: string;
  status?: ContentMessageStatus;
  id?: string;
}): Promise<ContentMessageRow> {
  const [message] = await getDb().insert(contentMessage).values({
    ...(args.id ? { id: args.id } : {}),
    workspaceId: args.workspaceId,
    threadId: args.threadId,
    role: args.role,
    content: args.content,
    status: args.status ?? "complete",
  }).returning();
  if (!message) throw new Error("Content message could not be saved.");
  await getDb().update(contentThread).set({ updatedAt: new Date() })
    .where(and(eq(contentThread.workspaceId, args.workspaceId), eq(contentThread.id, args.threadId)));
  return message;
}

/** Saves each streamed assistant step under one server-generated id for reliable resume. */
export async function upsertContentAssistantMessage(args: {
  id: string;
  workspaceId: string;
  threadId: string;
  content: string;
  status: ContentMessageStatus;
}): Promise<void> {
  await getDb().insert(contentMessage).values({
    id: args.id,
    workspaceId: args.workspaceId,
    threadId: args.threadId,
    role: "assistant",
    content: args.content,
    status: args.status,
  }).onConflictDoUpdate({
    target: contentMessage.id,
    set: { content: args.content, status: args.status },
    setWhere: eq(contentMessage.workspaceId, args.workspaceId),
  });
  await getDb().update(contentThread).set({ updatedAt: new Date() })
    .where(and(eq(contentThread.workspaceId, args.workspaceId), eq(contentThread.id, args.threadId)));
}

export async function createContentDraft(args: {
  workspaceId: string;
  threadId: string;
} & ContentDraftInput): Promise<ContentDraftRow> {
  const [draft] = await getDb().insert(contentDraft).values(args).returning();
  if (!draft) throw new Error("Content draft could not be saved.");
  return draft;
}

export async function listContentDrafts(workspaceId: string, limit = 10): Promise<ContentDraftRow[]> {
  return getDb().select().from(contentDraft)
    .where(eq(contentDraft.workspaceId, workspaceId))
    .orderBy(desc(contentDraft.updatedAt))
    .limit(limit);
}
