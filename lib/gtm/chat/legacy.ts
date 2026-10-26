import type { InterviewState } from "@/lib/onboarding/interview";
import type { SeoMessageRow } from "@/lib/seo-agent/conversations";
import type { GtmUIMessage } from "./types";

/** Compatibility projection only; confirmed profile storage remains authoritative outside this transcript. */
export function adaptLegacyTurns({ turns, interview }: { turns: SeoMessageRow[]; interview: InterviewState | null }): GtmUIMessage[] {
  const messages: GtmUIMessage[] = turns.map(turn => ({
    id: turn.id, role: turn.role,
    parts: [
      ...(turn.content ? [{ type: "text" as const, text: turn.content }] : []),
      ...(turn.parts.cards ?? []).map(card => ({ type: "data-card" as const, data: structuredClone(card) })),
      { type: "data-legacy", data: structuredClone({ status: turn.status, creditsUsed: turn.creditsUsed, createdAt: turn.createdAt,
        ...(turn.parts.followUps ? { followUps: turn.parts.followUps } : {}),
        ...(turn.parts.plan ? { plan: turn.parts.plan } : {}),
        ...(turn.parts.notices ? { notices: turn.parts.notices } : {}),
      }) },
    ],
  }));
  if (interview) {
    const statePart = { type: "data-interview" as const, data: structuredClone(interview) };
    const assistant = messages.findLast(m => m.role === "assistant");
    if (assistant) assistant.parts.push(statePart);
    else messages.push({ id: "legacy-interview-state", role: "assistant", parts: [statePart] });
  }
  return messages;
}
