import type { SeoMessageRow } from "./conversations";

export function isResearchConversation(conversation: { messages: SeoMessageRow[] }): boolean {
  return !conversation.messages.some((message) => message.parts.cards?.some((card) =>
    card.tool === "gtm_journey" || card.tool === "onboarding_interview"));
}
