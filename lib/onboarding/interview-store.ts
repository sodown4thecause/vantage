import {
  INTERVIEW_CARD_TOOL,
  INTERVIEW_TITLE,
  interviewStateSchema,
  type InterviewState,
} from "@/lib/onboarding/interview";
import { getConversation, listConversations, type SeoMessageRow } from "@/lib/seo-agent/conversations";

/*
 * Interview progress lives in an ordinary workspace conversation: each assistant turn carries the answers so far
 * in an `onboarding_interview` card. Callers must have run authorizeWorkspace; every read is workspace-scoped.
 */

export type InterviewConversation = {
  id: string;
  state: InterviewState;
  turns: { role: "user" | "assistant"; content: string }[];
};

const isInterviewMessage = (message: SeoMessageRow) =>
  message.role === "assistant" && message.parts.cards?.some((card) => card.tool === INTERVIEW_CARD_TOOL);

/** The latest saved state in an interview conversation. Invalid stored state restarts from the first question. */
export function interviewStateOf(messages: SeoMessageRow[]): InterviewState {
  const latest = messages.findLast(isInterviewMessage);
  const data = latest?.parts.cards?.find((card) => card.tool === INTERVIEW_CARD_TOOL)?.data;
  const parsed = interviewStateSchema.safeParse(data);
  return parsed.success ? parsed.data : { answers: {}, complete: false };
}

export function interviewCard(state: InterviewState) {
  return { tool: INTERVIEW_CARD_TOOL, title: "Product setup", fetchedAt: null, cached: false, data: state };
}

/** An interview conversation by id, or null when it is missing, in another workspace, or not an interview. */
export async function loadInterview(workspaceId: string, conversationId: string): Promise<InterviewConversation | null> {
  const conversation = await getConversation(workspaceId, conversationId);
  if (!conversation || conversation.title !== INTERVIEW_TITLE) return null;
  if (conversation.messages.some((message) => message.role === "assistant" && !isInterviewMessage(message))) return null;
  return {
    id: conversation.id,
    state: interviewStateOf(conversation.messages),
    turns: conversation.messages.map((message) => ({ role: message.role, content: message.content })),
  };
}

/** The most recent unfinished interview, so a returning owner picks up at the next unanswered question. */
export async function findResumableInterview(workspaceId: string): Promise<InterviewConversation | null> {
  const recent = await listConversations(workspaceId, 30);
  const latest = recent.find((conversation) => conversation.title === INTERVIEW_TITLE);
  if (!latest) return null;
  const interview = await loadInterview(workspaceId, latest.id);
  return interview && !interview.state.complete ? interview : null;
}
