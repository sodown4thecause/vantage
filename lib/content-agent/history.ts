export const CONTENT_AGENT_MAX_HISTORY_MESSAGES = 20;
export const CONTENT_AGENT_MAX_HISTORY_CHARS = 32_000;

type ContentHistoryMessage = {
  role: string;
  status: string;
  content: string;
};

/** Keep full history in storage/display while bounding model context to recent completed turns. */
export function contentAgentHistory<T extends ContentHistoryMessage>(messages: T[]): T[] {
  const eligible = messages.filter((message) => message.role === "user" || message.status === "complete");
  const window = eligible.slice(-CONTENT_AGENT_MAX_HISTORY_MESSAGES);
  const currentUserIndex = window.findLastIndex((message) => message.role === "user");
  const currentUser = currentUserIndex >= 0 ? window[currentUserIndex] : undefined;
  const recent = new Map<number, T>();
  if (currentUser) recent.set(currentUserIndex, { ...currentUser });
  let remaining = Math.max(0, CONTENT_AGENT_MAX_HISTORY_CHARS - (currentUser?.content.length ?? 0));

  for (let index = window.length - 1; index >= 0; index--) {
    if (index === currentUserIndex || remaining <= 0) continue;
    const message = window[index]!;
    const content = message.content.length > remaining ? message.content.slice(-remaining) : message.content;
    recent.set(index, { ...message, content });
    remaining -= content.length;
  }

  return [...recent.entries()].sort(([left], [right]) => left - right).map(([, message]) => message);
}
