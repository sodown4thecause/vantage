import { z } from "zod";

import { authorizeWorkspace } from "@/lib/auth/workspace";
import { setDigestSchedule } from "@/lib/digest/preferences";
import { deriveProfileFromUrl } from "@/lib/onboarding/derive";
import { FIELD_LABELS, type ProfileDraft, type ProfileField } from "@/lib/onboarding/draft";
import {
  applyAnswer,
  completionMessage,
  confirmFields,
  draftReviewMessage,
  hostOf,
  INTERVIEW_TITLE,
  nextStep,
  normaliseTimeZone,
  promptFor,
  reviewingDraft,
  stepForFieldErrors,
  toProfileInput,
  type InterviewAnswers,
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
 * One interview turn. The first answer is the product's website: the route reads it and has the model draft the rest
 * of the profile, which the owner confirms on one editable card (`confirm`). Without a draft (no AI Gateway, an
 * unreadable site) it falls back to one question per field. Every confirmed value goes through the same per-field
 * validation, and the last step saves the monitoring profile through the same repository function and validation as
 * the onboarding form.
 */

const field = z.string().max(8000).optional();
const bodySchema = z.object({
  workspaceId: z.uuid(),
  conversationId: z.uuid().optional(),
  // Matches the onboarding form's longest field, so "Keep" works for a long existing description.
  answer: z.string().trim().min(1).max(8000).optional(),
  /** Card fields the owner accepted or edited. Lists are comma separated, as typed. */
  confirm: z.object({ productDescription: field, targetCustomer: field, competitors: field, communities: field, keywords: field }).optional(),
  timeZone: z.string().max(64).optional(),
}).refine((body) => (body.answer === undefined) !== (body.confirm === undefined), { message: "Send an answer or confirmed fields" });

const DERIVE_TIMEOUT_MS = 45_000;

export async function POST(req: Request): Promise<Response> {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  const { workspaceId, conversationId, confirm } = parsed.data;
  // What the transcript shows for a card confirmation.
  const answer = parsed.data.answer ?? (Object.keys(confirm ?? {}).length > 1 ? "Looks right" : `Confirmed: ${FIELD_LABELS[Object.keys(confirm ?? {})[0] as ProfileField] ?? "profile"}`);
  const timeZone = normaliseTimeZone(parsed.data.timeZone);
  try {
    const authorization = await authorizeWorkspace(workspaceId);
    if (!authorization.ok) return Response.json({ error: "forbidden" }, { status: authorization.status });

    const existing = conversationId ? await loadInterview(workspaceId, conversationId) : null;
    if (conversationId && !existing) return Response.json({ error: "not_found" }, { status: 404 });
    if (existing?.state.complete) return Response.json({ error: "already_complete" }, { status: 409 });
    const current = await getLatestMonitoringProfile(workspaceId);
    let answers: InterviewAnswers = existing?.state.answers ?? {};
    let draft: ProfileDraft | undefined = existing?.state.draft;
    const rejected = (message: string, prompt?: InterviewPrompt) => Response.json({
      conversationId: existing?.id ?? "", complete: false, rejected: true, message, prompt, draft, answers,
    } satisfies InterviewResponse);

    // A null step means every answer is in but the last save failed: this message retries the save.
    const step = nextStep(answers);
    if (confirm) {
      if (!existing || !reviewingDraft(answers, draft)) return Response.json({ error: "invalid_request" }, { status: 400 });
      const confirmed = confirmFields(answers, confirm);
      if (!confirmed.ok) return rejected(confirmed.error, promptFor(confirmed.field, answers, current, timeZone));
      answers = confirmed.answers;
    } else if (step) {
      const applied = applyAnswer(answers, step, answer, { timeZone });
      if (!applied.ok) return rejected(applied.error, promptFor(step, answers, current, timeZone));
      answers = applied.answers;
      if (step === "productUrl") {
        draft = await deriveProfileFromUrl({ workspaceId, url: answers.productUrl!, signal: AbortSignal.timeout(DERIVE_TIMEOUT_MS) }) ?? undefined;
      }
    }

    // The message for an unfinished interview: the draft card while it is under review, otherwise the next question.
    const pending = (prompt: InterviewPrompt) => reviewingDraft(answers, draft) ? draftReviewMessage(answers) : prompt.question;

    if (!existing) {
      const prompt = promptFor(nextStep(answers)!, answers, current, timeZone);
      const message = pending(prompt);
      const { id } = await appendTurn(workspaceId, { title: INTERVIEW_TITLE }, { content: answer }, {
        content: message,
        parts: { cards: [interviewCard({ answers, draft, complete: false })] },
      });
      return Response.json({ conversationId: id, complete: false, message, prompt, draft, answers } satisfies InterviewResponse);
    }

    const id = existing.id;
    await appendMessage(workspaceId, id, { role: "user", content: answer });
    const reply = async (message: string, state: InterviewState, prompt?: InterviewPrompt, profileSaved = false) => {
      await appendMessage(workspaceId, id, { role: "assistant", content: message, parts: { cards: [interviewCard(state)] } });
      return Response.json({
        conversationId: id, complete: state.complete, message, prompt, draft: state.draft, answers: state.answers,
        ...(profileSaved ? { profileSaved: true, productName: hostOf(state.answers.productUrl) } : {}),
      } satisfies InterviewResponse);
    };

    const following = nextStep(answers);
    if (following) {
      const prompt = promptFor(following, answers, current, timeZone);
      return await reply(pending(prompt), { answers, draft, complete: false }, prompt);
    }

    const validated = validateMonitoringProfileInput(toProfileInput(answers, current));
    if (!validated.ok) {
      const retry = stepForFieldErrors(answers, validated.errors);
      if (!retry) throw new Error("profile validation failed without a field error");
      const prompt = promptFor(retry.step, retry.answers, current, timeZone);
      return await reply(`${retry.error} ${prompt.question}`, { answers: retry.answers, draft, complete: false }, prompt);
    }

    let profileId: string;
    await appendMessage(workspaceId, id, {
      role: "assistant", content: "Saving your product setup…", parts: { cards: [interviewCard({ answers, draft, complete: false })] },
    });
    try {
      profileId = (await saveMonitoringProfile({ workspaceId, input: validated.value, profileId: id })).id;
    } catch (error) {
      if (error instanceof PlanLimitError) {
        const rest = { ...answers };
        delete rest.keywords;
        const prompt = promptFor("keywords", rest, current, timeZone);
        return await reply(`${error.message} ${prompt.question}`, { answers: rest, draft, complete: false }, prompt);
      }
      console.error("[interview route] profile save failed");
      return await reply("I couldn’t save your profile just now. Send any message to try again.", { answers, draft, complete: false });
    }
    try {
      await indexSavedProfile(workspaceId, profileId);
    } catch {
      console.error("[interview route] indexing failed");
    }
    let digestSaved = true;
    if (answers.digest) {
      try {
        await setDigestSchedule(workspaceId, answers.digest);
      } catch {
        digestSaved = false;
        console.error("[interview route] digest save failed");
      }
    }
    return await reply(completionMessage(answers, digestSaved), { answers, draft, complete: digestSaved }, undefined, true);
  } catch (error) {
    if (error instanceof ConversationNotFoundError) return Response.json({ error: "not_found" }, { status: 404 });
    console.error("[interview route] failed");
    return Response.json({ error: "request_failed" }, { status: 500 });
  }
}
