import { createUIMessageStream, createUIMessageStreamResponse, type ModelMessage } from "ai";
import { z } from "zod";

import { authorizeWorkspace } from "@/lib/auth/workspace";
import { consume, release } from "@/lib/plans/limits";
import { getLatestMonitoringProfile } from "@/lib/profile/repository";
import type { MonitoringProfileView } from "@/lib/profile/types";
import { classifyQuestion, type Classification } from "@/lib/seo-agent/classify";
import {
  appendMessage,
  claimPlan,
  ConversationNotFoundError,
  createConversation,
  getConversation,
  type SeoMessageRow,
  unclaimPlan,
} from "@/lib/seo-agent/conversations";
import {
  FAILURE_COPY,
  REFUSAL_COPY,
  runAgent,
  type AgentOutcome,
  type AgentProfile,
  type AgentRun,
} from "@/lib/seo-agent/execute";
import { seoModels } from "@/lib/seo-agent/models";
import { profileSummary } from "@/lib/seo-agent/prompt";
import { profileContext } from "@/lib/seo-agent/suggestions";

const QUESTION_LIMIT = "seo_questions_per_month";
const MESSAGE_MAX_CHARS = 2000;
const TITLE_MAX_CHARS = 80;
/** Earlier turns sent to the model with each question; older turns are not replayed. */
const HISTORY_MAX_MESSAGES = 20;
const UPGRADE_COPY = "You've used this month's SEO agent questions. Upgrade to Pro for more.";
/** Approved plans run exactly the calls they hold; this classification only names the intent to fall back to. */
const APPROVAL_CLASSIFICATION: Classification = { intent: "all", domains: [], keywords: [], engines: [] };

const bodySchema = z.object({
  workspaceId: z.uuid(),
  conversationId: z.uuid().optional(),
  message: z.string().optional(),
  approvePlan: z.uuid().optional(),
});

type Body = z.infer<typeof bodySchema>;

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

async function readBody(req: Request): Promise<Body | null> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return null;
  }
  const parsed = bodySchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * POST /seo/chat. Exactly one of `message` (a new question, charged to the monthly allowance) or `approvePlan` (the id
 * of an assistant message whose plan the owner runs, not charged) is sent with the workspace and conversation.
 */
export async function POST(req: Request): Promise<Response> {
  const body = await readBody(req);
  if (!body) return json({ error: "invalid_request" }, 400);

  const authorization = await authorizeWorkspace(body.workspaceId);
  if (!authorization.ok) return json({ error: "forbidden" }, 403);

  if (!seoModels()) return json({ error: "not_configured" }, 503);

  if ((body.message !== undefined) === (body.approvePlan !== undefined)) {
    return json({ error: "invalid_request" }, 400);
  }
  if (body.message !== undefined) {
    return askQuestion(req, body.workspaceId, body.conversationId, body.message);
  }
  return approvePlan(req, body.workspaceId, body.conversationId, body.approvePlan!);
}

async function askQuestion(
  req: Request,
  workspaceId: string,
  conversationId: string | undefined,
  rawMessage: string,
): Promise<Response> {
  const message = rawMessage.trim();
  if (message.length === 0 || message.length > MESSAGE_MAX_CHARS) return json({ error: "invalid_request" }, 400);

  // The conversation is checked before the question is charged, so an unknown id costs nothing.
  const existing = conversationId ? await getConversation(workspaceId, conversationId) : null;
  if (conversationId && !existing) return json({ error: "not_found" }, 404);

  const allowance = await consume(workspaceId, QUESTION_LIMIT);
  if (!allowance.allowed) return textResponse(UPGRADE_COPY, existing?.id);

  let knownConversation = existing?.id;
  let userSaved = false;
  try {
    // A new conversation is created only after the charge, so an exhausted allowance leaves no empty chat behind.
    const id = existing?.id ?? (await createConversation(workspaceId, message.slice(0, TITLE_MAX_CHARS))).id;
    knownConversation = id;
    await appendMessage(workspaceId, id, { role: "user", content: message });
    userSaved = true;

    const profile = toAgentProfile(await getLatestMonitoringProfile(workspaceId));
    const classification = await classifyQuestion(workspaceId, message, profileSummary(profile), { signal: req.signal });
    const run = await runAgent({
      workspaceId,
      conversationId: id,
      question: message,
      history: historyOf(existing?.messages),
      classification,
      profile,
    }, { signal: req.signal });
    return answerResponse({ workspaceId, conversationId: id, run });
  } catch (err) {
    await release(workspaceId, QUESTION_LIMIT);
    if (err instanceof ConversationNotFoundError) return json({ error: "not_found" }, 404);
    console.error("[seo-agent] question failed", { error: err instanceof Error ? err.name : "unknown" });
    // Keep the history paired: the question is saved, so its reply is saved too.
    if (userSaved && knownConversation) await saveFailure(workspaceId, knownConversation, FAILURE_COPY);
    return textResponse(FAILURE_COPY, knownConversation);
  }
}

async function approvePlan(
  req: Request,
  workspaceId: string,
  conversationId: string | undefined,
  messageId: string,
): Promise<Response> {
  if (!conversationId) return json({ error: "invalid_request" }, 400);
  const conversation = await getConversation(workspaceId, conversationId);
  if (!conversation) return json({ error: "not_found" }, 404);
  if (!conversation.messages.some((message) => message.id === messageId)) return json({ error: "not_found" }, 404);

  // The claim is one conditional update, so a double click cannot run the plan twice.
  const plan = await claimPlan(workspaceId, messageId);
  if (!plan || plan.length === 0) return json({ error: "already_run" }, 409);

  try {
    const profile = toAgentProfile(await getLatestMonitoringProfile(workspaceId));
    const run = await runAgent({
      workspaceId,
      conversationId,
      question: "",
      history: historyOf(conversation.messages),
      classification: APPROVAL_CLASSIFICATION,
      profile,
      approved: plan,
    }, { signal: req.signal });
    return answerResponse({ workspaceId, conversationId, run, approvedMessageId: messageId });
  } catch (err) {
    console.error("[seo-agent] approved plan failed", { error: err instanceof Error ? err.name : "unknown" });
    await returnPlan(workspaceId, messageId);
    return textResponse(FAILURE_COPY, conversationId);
  }
}

function toAgentProfile(profile: MonitoringProfileView | null): AgentProfile {
  return {
    ...profileContext(profile),
    description: profile?.productDescription ?? "",
    targetCustomer: profile?.targetCustomer ?? "",
  };
}

/**
 * Stored text messages as model history, oldest first. Empty messages are dropped (providers reject empty text), and so
 * are leading assistant turns left by the window, so the history always starts with a user turn.
 */
function historyOf(messages: SeoMessageRow[] | undefined): ModelMessage[] {
  const kept = (messages ?? [])
    .filter((message) => message.content.trim() !== "")
    .slice(-HISTORY_MAX_MESSAGES);
  const firstUser = kept.findIndex((message) => message.role === "user");
  return (firstUser === -1 ? [] : kept.slice(firstUser))
    .map((message) => ({ role: message.role, content: message.content }));
}

/**
 * Streams the answer and settles the turn when it ends. A question that produced no answer gives its charge back and
 * saves the reply copy as incomplete; a plan that produced no answer goes back to needs_approval. A partial answer is
 * kept as incomplete. The stream is held open until the save finishes.
 */
function answerResponse(args: {
  workspaceId: string;
  conversationId: string;
  run: AgentRun;
  /** Set for an approved plan: the message whose plan this run belongs to. Its run is not a charged question. */
  approvedMessageId?: string;
}): Response {
  const stream = createUIMessageStream({
    onError: () => FAILURE_COPY,
    execute: async ({ writer }) => {
      writer.write({ type: "message-metadata", messageMetadata: { conversationId: args.conversationId } });
      const outcome = await args.run.write(writer);
      await settleTurn(args, outcome);
    },
  });
  return createUIMessageStreamResponse({ stream });
}

async function settleTurn(
  args: { workspaceId: string; conversationId: string; approvedMessageId?: string },
  outcome: AgentOutcome,
): Promise<void> {
  try {
    if (outcome.status === "failed" || outcome.status === "refused") {
      if (args.approvedMessageId) {
        await returnPlan(args.workspaceId, args.approvedMessageId);
        return;
      }
      await release(args.workspaceId, QUESTION_LIMIT);
      await saveFailure(args.workspaceId, args.conversationId, outcome.status === "refused" ? REFUSAL_COPY : FAILURE_COPY);
      return;
    }
    const status = outcome.status === "incomplete"
      ? "incomplete"
      : outcome.plan.length > 0 ? "needs_approval" : "complete";
    await appendMessage(args.workspaceId, args.conversationId, {
      role: "assistant",
      content: outcome.content,
      parts: { cards: outcome.cards, followUps: outcome.followUps, plan: outcome.plan, notices: outcome.notices },
      status,
      creditsUsed: outcome.creditsUsed,
    });
  } catch (err) {
    console.error("[seo-agent] saving the answer failed", { error: err instanceof Error ? err.name : "unknown" });
  }
}

/** Saves the reply copy for a question that got no answer, so the history shows a reply. Best effort. */
async function saveFailure(workspaceId: string, conversationId: string, copy: string): Promise<void> {
  try {
    await appendMessage(workspaceId, conversationId, { role: "assistant", content: copy, status: "incomplete" });
  } catch (err) {
    console.error("[seo-agent] saving the failure reply failed", { error: err instanceof Error ? err.name : "unknown" });
  }
}

/** Returns an approved plan to needs_approval after a run that produced no answer. Best effort. */
async function returnPlan(workspaceId: string, messageId: string): Promise<void> {
  try {
    await unclaimPlan(workspaceId, messageId);
  } catch (err) {
    console.error("[seo-agent] returning the plan failed", { error: err instanceof Error ? err.name : "unknown" });
  }
}

/** A fixed reply with no model call: the upgrade notice, or the generic failure. */
function textResponse(value: string, conversationId?: string): Response {
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      writer.write({ type: "message-metadata", messageMetadata: { conversationId } });
      const id = crypto.randomUUID();
      writer.write({ type: "text-start", id });
      writer.write({ type: "text-delta", id, delta: value });
      writer.write({ type: "text-end", id });
    },
  });
  return createUIMessageStreamResponse({ stream });
}
