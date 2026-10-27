import type { OutcomeEvent } from "@/lib/outcomes/types";

export type HandoffState = "replied" | "sent" | "copied" | "opened";

const STATE_FOR_EVENT: Partial<Record<OutcomeEvent, HandoffState>> = {
  replied: "replied",
  sent: "sent",
  copy: "copied",
  open: "opened",
};

const STATE_RANK: HandoffState[] = ["replied", "sent", "copied", "opened"];

/**
 * How far the owner got with one conversation. Sent and replied are marks the owner makes
 * themselves; Vantage never knows whether anything was posted. The furthest step wins.
 */
export function handoffState(events: OutcomeEvent[]): HandoffState | null {
  const states = events.flatMap((event) => STATE_FOR_EVENT[event] ?? []);
  return STATE_RANK.find((state) => states.includes(state)) ?? null;
}

export const HANDOFF_STATE_LABEL: Record<HandoffState, string> = {
  replied: "You marked this replied to",
  sent: "You marked this sent",
  copied: "Reply copied",
  opened: "Thread opened",
};

export type MonthlyRecap = { copied: number; sent: number; replied: number };

/** One plain sentence for the queue, or null when nothing has happened this month. */
export function recapLine(recap: MonthlyRecap): string | null {
  const parts = [
    recap.copied > 0 ? `copied ${recap.copied} ${recap.copied === 1 ? "reply" : "replies"}` : null,
    recap.sent > 0 ? `marked ${recap.sent} sent` : null,
    recap.replied > 0 ? `had ${recap.replied} ${recap.replied === 1 ? "reply" : "replies"} back` : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return null;
  const last = parts.pop()!;
  return `This month you've ${parts.length ? `${parts.join(", ")} and ${last}` : last}.`;
}
