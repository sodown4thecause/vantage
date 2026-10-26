export const CONTENT_AGENT_MAX_HISTORY_MESSAGES = 20;
export const CONTENT_AGENT_MAX_HISTORY_CHARS = 24_000;

type ContentHistoryMessage = {
  role: string;
  status: string;
  content: string;
};

/** Keep full history in storage/display while bounding model context to recent completed turns. */
export function contentAgentHistory<T extends ContentHistoryMessage>(messages: T[]): T[] {
  const eligible = messages.filter((message) => message.role === "user" || message.status === "complete");
  const recent: T[] = [];
  let remaining = CONTENT_AGENT_MAX_HISTORY_CHARS;

  for (const message of eligible.slice(-CONTENT_AGENT_MAX_HISTORY_MESSAGES).reverse()) {
    if (remaining <= 0) break;
    const content = message.content.length > remaining ? message.content.slice(-remaining) : message.content;
    recent.push({ ...message, content });
    remaining -= content.length;
  }

  return recent.reverse();
}
