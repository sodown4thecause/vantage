import { z } from "zod";

import { authorizeWorkspace } from "@/lib/auth/workspace";
import { answerGtmQuestion } from "@/lib/gtm/answer";
import { getOpportunityDetail, listOpportunityQueue } from "@/lib/opportunities/run";
import { consume, release } from "@/lib/plans/limits";
import { getLatestMonitoringProfile } from "@/lib/profile/repository";
import { PaidCallDeniedError } from "@/lib/providers/paid-call";
import { appendTurn, ConversationNotFoundError, getConversation } from "@/lib/seo-agent/conversations";
import { INTERVIEW_CARD_TOOL } from "@/lib/onboarding/interview";
import { seoModels } from "@/lib/seo-agent/models";
import { redditThreadBlocks } from "@/lib/workspace/blocks";
import { takoResearchBlocks } from "@/lib/research/blocks";

const bodySchema = z.object({
  workspaceId: z.uuid(),
  message: z.string().trim().min(1).max(2000),
  conversationId: z.uuid().optional(),
});
const QUESTION_LIMIT = "seo_questions_per_month";

export async function POST(req: Request): Promise<Response> {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  const { workspaceId, message, conversationId } = parsed.data;
  const quotaPeriod = new Date();
  let reserved = false;
  let step: "authorize" | "history" | "quota" | "context" | "answer" | "persist" = "authorize";
  try {
    const authorization = await authorizeWorkspace(workspaceId);
    if (!authorization.ok) return Response.json({ error: "forbidden" }, { status: 403 });
    step = "history";
    const existing = conversationId ? await getConversation(workspaceId, conversationId) : null;
    if (conversationId && (!existing
      || existing.messages.some((item) => item.parts.cards?.some((card) => card.tool === INTERVIEW_CARD_TOOL))
      || !existing.messages.some((item) => item.parts.cards?.some((card) => card.tool === "gtm_journey")))) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    if (!seoModels()) return Response.json({ error: "not_configured" }, { status: 503 });
    step = "quota";
    const allowance = await consume(workspaceId, QUESTION_LIMIT, 1, quotaPeriod);
    if (!allowance.allowed) return Response.json({
      error: "quota_exhausted",
      message: "GTM and SEO share the monthly question allowance.",
    }, { status: 429 });
    reserved = true;
    step = "context";
    const profile = await getLatestMonitoringProfile(workspaceId);
    const queue = await listOpportunityQueue({ workspaceId, limit: 5 });
    const details = await Promise.all(queue.slice(0, 5).map((item) => getOpportunityDetail({
      workspaceId, opportunityId: item.id,
    })));
    const evidence = details.filter((detail) => detail !== null);
    step = "answer";
    const result = await answerGtmQuestion({
      workspaceId, message, profile, evidence, history: existing?.messages ?? [], signal: req.signal,
    });
    // Evidence cards come from stored documents, never from model output.
    const blocks = [...redditThreadBlocks(evidence), ...(result.takoResults ?? []).flatMap(takoResearchBlocks)].slice(0, 12);
    step = "persist";
    const { id } = await appendTurn(workspaceId, existing?.id ?? { title: message.slice(0, 80) }, { content: message }, {
      content: result.answer,
      parts: {
        cards: [{
          tool: "gtm_journey", title: "GTM next moves", fetchedAt: new Date().toISOString(),
          cached: false, sandbox: false, data: { actions: result.actions, evidence, blocks },
        }],
        followUps: { seo: result.actions[0]!.prompt, geo: result.actions[1]!.prompt, content: result.actions[2]!.prompt },
        notices: ["GTM and SEO share the monthly question allowance."],
      },
    });
    return Response.json({ conversationId: id, answer: result.answer, actions: result.actions, evidence, blocks });
  } catch (error) {
    console.error("[gtm chat] request failed", { step, category: error instanceof ConversationNotFoundError ? "not_found" : error instanceof PaidCallDeniedError ? "paid_call_denied" : "unexpected" });
    if (reserved) {
      try {
        await release(workspaceId, QUESTION_LIMIT, 1, quotaPeriod);
      } catch {
        console.error("[gtm chat] request failed", { step: "refund", category: "unexpected" });
      }
    }
    if (error instanceof ConversationNotFoundError) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ error: "request_failed" }, { status: error instanceof PaidCallDeniedError ? 503 : 500 });
  }
}
