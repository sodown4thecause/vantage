import type { UIMessage } from "ai";

import { authorizeWorkspace } from "@/lib/auth/workspace";
import { createContentAgent } from "@/lib/content-agent/agent";
import { contentChatRequestSchema } from "@/lib/content-agent/contracts";
import { contentAgentHistory } from "@/lib/content-agent/history";
import { contentAgentModels } from "@/lib/content-agent/models";
import {
  appendContentMessage,
  createContentThread,
  getContentBrandVoiceProfile,
  getContentThreadContext,
  type ContentMessageRow,
} from "@/lib/content-agent/repository";
import { createContentAgentResponse } from "@/lib/content-agent/stream";

export const dynamic = "force-dynamic";

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

async function readBody(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function toUiMessage(row: ContentMessageRow, threadId: string): UIMessage<{ threadId: string }> {
  return {
    id: row.id,
    role: row.role,
    parts: row.content ? [{ type: "text", text: row.content }] : [],
    metadata: { threadId },
  };
}

export async function POST(request: Request): Promise<Response> {
  const raw = await readBody(request);
  const parsed = contentChatRequestSchema.safeParse(raw);
  if (!parsed.success) return json({ error: "invalid_request" }, 400);

  const { workspaceId, threadId: requestedThreadId, message } = parsed.data;
  const retry = parsed.data.retry === true;
  const authorization = await authorizeWorkspace(workspaceId);
  if (!authorization.ok) return json({ error: authorization.error }, authorization.status);
  if (retry && !requestedThreadId) return json({ error: "retry_requires_thread" }, 400);

  const models = contentAgentModels();
  if (!models) return json({ error: "not_configured" }, 503);

  const [existing, brandVoiceProfile] = await Promise.all([
    requestedThreadId ? getContentThreadContext(workspaceId, requestedThreadId) : Promise.resolve(null),
    getContentBrandVoiceProfile(workspaceId),
  ]);
  if (requestedThreadId && !existing) return json({ error: "not_found" }, 404);

  let threadId = existing?.thread.id;
  try {
    const priorMessages = existing?.messages ?? [];
    const latestUserIndex = priorMessages.findLastIndex((row) => row.role === "user");
    const latestUserMessage = latestUserIndex >= 0 ? priorMessages[latestUserIndex] : undefined;
    if (retry && (!latestUserMessage || latestUserMessage.content !== message)) {
      return json({ error: "retry_mismatch" }, 409);
    }
    if (!threadId) {
      const thread = await createContentThread(workspaceId, message);
      threadId = thread.id;
    }
    const userMessage = retry
      ? latestUserMessage!
      : await appendContentMessage({
        workspaceId,
        threadId,
        role: "user",
        content: message,
      });
    const messagesForAgent = contentAgentHistory(retry
      ? priorMessages.slice(0, latestUserIndex + 1)
      : [...priorMessages, userMessage]);
    const uiMessages = messagesForAgent.map((row) => toUiMessage(row, threadId!));
    const agent = createContentAgent({ workspaceId, threadId, models, brandVoiceProfile });
    return await createContentAgentResponse({
      workspaceId,
      threadId,
      agent,
      messages: uiMessages,
      abortSignal: request.signal,
      models,
    });
  } catch (error) {
    if (threadId) {
      await appendContentMessage({
        workspaceId,
        threadId,
        role: "assistant",
        content: "The assistant couldn't start this turn. Try again.",
        status: "failed",
      }).catch(() => undefined);
    }
    console.error("[content-agent] request failed", { error: error instanceof Error ? error.name : "unknown" });
    return json({ error: "agent_unavailable", ...(threadId ? { threadId } : {}) }, 503);
  }
}
