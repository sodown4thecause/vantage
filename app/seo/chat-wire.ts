import type { UIMessage } from "ai";

import type { CardView } from "./cards";

/*
 * The SEO chat's wire contract: the request body the client sends, the stored-to-message merge, and the message-to-view
 * mapping. Client-safe and pure: it imports no server modules, so the tests read exactly what the UI reads.
 */

export type Category = "seo" | "geo" | "content";
export type FollowUps = { seo: string; geo: string; content: string };
export type PlannedCall = { tool: string; input: Record<string, unknown>; credits: number };
export type MessageStatus = "complete" | "incomplete" | "needs_approval" | "approved";
export type StoredParts = { cards?: CardView[]; followUps?: FollowUps; plan?: PlannedCall[]; notices?: string[] };

/** A stored message, as the server page reads it from the database. */
export type HistoryMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  parts: StoredParts;
  status: MessageStatus;
  creditsUsed: number;
  createdAt: string;
};

/** Streamed answers carry their parts here; stored messages carry them under `parts` (see `viewOf`). */
export type ChatMetadata = StoredParts & {
  conversationId?: string;
  messageId?: string;
  status?: MessageStatus;
  creditsUsed?: number;
  parts?: StoredParts;
};
export type ChatMessage = UIMessage<ChatMetadata>;

/** The body the client posts to /seo/chat: exactly one of `message` or `approvePlan`. */
export type ChatRequestBody =
  | { workspaceId: string; conversationId: string | undefined; message: string }
  | { workspaceId: string; conversationId: string | undefined; approvePlan: string };

/**
 * A message's text. Text from separate steps is joined with a blank line, so two steps read as two paragraphs.
 */
export function textOf(message: Pick<ChatMessage, "parts">): string {
  return message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n\n");
}

/**
 * The request for one send. An approval wins over a message; a message is the last user message's text.
 */
export function buildRequestBody({
  workspaceId,
  conversationId,
  messages,
  body,
}: {
  workspaceId: string;
  conversationId?: string | undefined;
  messages: ChatMessage[];
  body: Record<string, unknown> | undefined;
}): ChatRequestBody {
  const scope = { workspaceId, conversationId };
  if (typeof body?.approvePlan === "string") return { ...scope, approvePlan: body.approvePlan };
  const last = messages.findLast((message) => message.role === "user");
  return { ...scope, message: last ? textOf(last) : "" };
}

/** A stored message as a chat message: its text and its stored parts, read back the same way a streamed one is. */
export function fromHistory(row: HistoryMessage): ChatMessage {
  return {
    id: row.id,
    role: row.role,
    parts: row.content ? [{ type: "text", text: row.content }] : [],
    metadata: { messageId: row.id, status: row.status, creditsUsed: row.creditsUsed, parts: row.parts },
  };
}

export type View = {
  messageId?: string;
  status: MessageStatus;
  creditsUsed: number;
  text: string;
  cards: CardView[];
  followUps?: FollowUps;
  plan: PlannedCall[];
  notices: string[];
};

export function viewOf(message: ChatMessage): View {
  const meta: ChatMetadata = message.metadata ?? {};
  // A stored message keeps its parts under `parts`; a streamed answer has them on its metadata.
  const parts: StoredParts = meta.parts ?? meta;
  return {
    messageId: meta.messageId,
    status: meta.status ?? "complete",
    creditsUsed: meta.creditsUsed ?? 0,
    text: textOf(message),
    cards: parts.cards ?? [],
    followUps: parts.followUps,
    plan: parts.plan ?? [],
    notices: parts.notices ?? [],
  };
}
