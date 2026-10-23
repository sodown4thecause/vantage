import { z } from "zod";

import { authorizeWorkspace } from "@/lib/auth/workspace";
import { setDigestHour } from "@/lib/digest/preferences";
import {
  applyAnswer,
  completionMessage,
  hostOf,
  INTERVIEW_TITLE,
  nextStep,
  normaliseTimeZone,
  promptFor,
  stepForFieldErrors,
  toProfileInput,
  type InterviewPrompt,
  type InterviewResponse,
  type InterviewState,
} from "@/lib/onboarding/interview";
import { interviewCard, loadInterview } from "@/lib/onboarding/interview-store";
import { PlanLimitError } from "@/lib/plans/types";
import { indexSavedProfile } from "@/lib/profile/index-profile";
import { getLatestMonitoringProfile, saveMonitoringProfile } from "@/lib/profile/repository";
import { validateMonitoringProfileInput } from "@/lib/profile/validate";
import { appendMessage, appendTurn, ConversationNotFoundError } from "@/lib/seo-agent/conversations";

/*
 * One interview turn: validate the answer for the next unanswered step, store it in the interview conversation and
 * return the next question. The last answer saves the monitoring profile through the same repository function and
 * validation as the onboarding form. No model call, so it works without the AI Gateway and spends no allowance.
 */

const bodySchema = z.object({
  workspaceId: z.uuid(),
  conversationId: z.uuid().optional(),
  // Matches the onboarding form's longest field, so "Keep" works for a long existing description.
  answer: z.string().trim().min(1).max(8000),
  timeZone: z.string().max(64).optional(),
});

export async function POST(req: Request): Promise<Response> {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  const { workspaceId, conversationId, answer } = parsed.data;
  const timeZone = normaliseTimeZone(parsed.data.timeZone);
  try {
    const authorization = await authorizeWorkspace(workspaceId);
    if (!authorization.ok) return Response.json({ error: "forbidden" }, { status: authorization.status });

    const existing = conversationId ? await loadInterview(workspaceId, conversationId) : null;
    if (conversationId && !existing) return Response.json({ error: "not_found" }, { status: 404 });
    if (existing?.state.complete) return Response.json({ error: "already_complete" }, { status: 409 });
    const current = await getLatestMonitoringProfile(workspaceId);
    let answers = existing?.state.answers ?? {};

    // A null step means every answer is in but the last save failed: this message retries the save.
    const step = nextStep(answers);
    if (step) {
      const applied = applyAnswer(answers, step, answer, { timeZone });
      if (!applied.ok) {
        return Response.json({
          conversationId: existing?.id ?? "", complete: false, rejected: true,
          message: applied.error, prompt: promptFor(step, answers, current, timeZone),
        } satisfies InterviewResponse);
      }
      answers = applied.answers;
    }

    if (!existing) {
      const prompt = promptFor(nextStep(answers)!, answers, current, timeZone);
      const { id } = await appendTurn(workspaceId, { title: INTERVIEW_TITLE }, { content: answer }, {
        content: prompt.question,
        parts: { cards: [interviewCard({ answers, complete: false })] },
      });
      return Response.json({ conversationId: id, complete: false, message: prompt.question, prompt } satisfies InterviewResponse);
    }

    const id = existing.id;
    await appendMessage(workspaceId, id, { role: "user", content: answer });
    const reply = async (message: string, state: InterviewState, prompt?: InterviewPrompt, profileSaved = false) => {
      await appendMessage(workspaceId, id, { role: "assistant", content: message, parts: { cards: [interviewCard(state)] } });
      return Response.json({
        conversationId: id, complete: state.complete, message, prompt,
        ...(profileSaved ? { profileSaved: true, productName: hostOf(state.answers.productUrl) } : {}),
      } satisfies InterviewResponse);
    };

    const following = nextStep(answers);
    if (following) {
      const prompt = promptFor(following, answers, current, timeZone);
      return await reply(prompt.question, { answers, complete: false }, prompt);
    }

    const validated = validateMonitoringProfileInput(toProfileInput(answers, current));
    if (!validated.ok) {
      const retry = stepForFieldErrors(answers, validated.errors);
      if (!retry) throw new Error("profile validation failed without a field error");
      const prompt = promptFor(retry.step, retry.answers, current, timeZone);
      return await reply(`${retry.error} ${prompt.question}`, { answers: retry.answers, complete: false }, prompt);
    }

    let profileId: string;
    await appendMessage(workspaceId, id, {
      role: "assistant", content: "Saving your product setup…", parts: { cards: [interviewCard({ answers, complete: false })] },
    });
    try {
      profileId = (await saveMonitoringProfile({ workspaceId, input: validated.value, profileId: id })).id;
    } catch (error) {
      if (error instanceof PlanLimitError) {
        const rest = { ...answers };
        delete rest.keywords;
        const prompt = promptFor("keywords", rest, current, timeZone);
        return await reply(`${error.message} ${prompt.question}`, { answers: rest, complete: false }, prompt);
      }
      console.error("[interview route] profile save failed");
      return await reply("I couldn’t save your profile just now. Send any message to try again.", { answers, complete: false });
    }
    try {
      await indexSavedProfile(workspaceId, profileId);
    } catch {
      console.error("[interview route] indexing failed");
    }
    let digestSaved = true;
    if (answers.digest) {
      try {
        await setDigestHour(workspaceId, answers.digest.hourUtc);
      } catch {
        digestSaved = false;
        console.error("[interview route] digest save failed");
      }
    }
    return await reply(completionMessage(answers, digestSaved), { answers, complete: digestSaved }, undefined, true);
  } catch (error) {
    if (error instanceof ConversationNotFoundError) return Response.json({ error: "not_found" }, { status: 404 });
    console.error("[interview route] failed");
    return Response.json({ error: "request_failed" }, { status: 500 });
  }
}
