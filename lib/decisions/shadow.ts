import { getDecisionMode } from "@/lib/cf/env";
import { getDb } from "@/lib/db/client";
import { decisionShadow } from "@/lib/db/schema";
import { askClef, type ClefAnswer, type ClefQuestion } from "@/lib/decisions/clef";

/** A thread is worth a paid full fetch when Clef is at least this sure. */
const PREFILTER_THRESHOLD = 0.5;

export const PREFILTER_QUESTIONS: Record<string, ClefQuestion> = {
  worth_fetching: {
    type: "noul",
    instructions:
      "Is this thread worth fetching in full for this workspace? Answer yes only when the thread is likely to hold a conversation the workspace could usefully join, not merely a mention of its topic.",
  },
};

/**
 * The ranking questions. Momentum is deliberately absent: it stays computed from
 * engagement data rather than asked of a model.
 */
export function rankingQuestions(segments: string[]): Record<string, ClefQuestion> {
  const fit: Record<string, string> = {};
  segments.slice(0, 8).forEach((segment, index) => {
    fit[`segment_${index + 1}`] = segment;
  });
  fit.not_fit = "None of these segments";
  return {
    fit: {
      type: "choice",
      instructions: "Which of the workspace's ideal-customer segments does this thread's author belong to?",
      criteria: fit,
    },
    answer_gap: {
      type: "noul",
      instructions: "Is the asker's question still unanswered, or answered badly enough that a better answer would help?",
    },
    expertise_match: {
      type: "score",
      instructions: "How well does the workspace's product and experience match what this thread needs?",
      criteria: ["none", "weak", "moderate", "strong"],
    },
    rules_ok: {
      type: "choice",
      instructions: "Do the community's stated rules allow a helpful reply from this workspace?",
      criteria: {
        allowed: "A helpful, non-promotional reply is allowed",
        ask_mods_first: "The rules are unclear or require asking the moderators first",
        not_allowed: "The rules prohibit this kind of reply or self-reference",
      },
    },
    timing: {
      type: "choice",
      instructions: "Where is the author in their decision process?",
      criteria: {
        exploring: "Learning about the problem space",
        evaluating: "Comparing options",
        deciding: "Choosing now",
        already_solved: "Already solved it or moved on",
      },
    },
  };
}

/** Thread text, then the workspace profile, then the community rules when known. */
export function rankingState(input: {
  thread: string;
  profileSummary: string;
  rulesText?: string | null;
}): string {
  const parts = [`Thread:\n${input.thread}`, `Workspace profile:\n${input.profileSummary}`];
  if (input.rulesText?.trim()) parts.push(`Community rules:\n${input.rulesText.trim()}`);
  return parts.join("\n\n");
}

/** A short, non-identifying profile summary for the decision state. */
export function profileSummary(profile: {
  productDescription?: string;
  targetCustomer?: string;
  topics?: string[];
} | null): string {
  if (!profile) return "No workspace profile is saved.";
  return [
    profile.productDescription?.slice(0, 1_000),
    profile.targetCustomer ? `Target customer: ${profile.targetCustomer.slice(0, 500)}` : null,
    profile.topics?.length ? `Topics: ${profile.topics.slice(0, 10).join(", ")}` : null,
  ].filter(Boolean).join("\n");
}

async function record(input: {
  workspaceId: string;
  subjectKind: "opportunity" | "document";
  subjectId: string;
  mode: "shadow" | "on";
  answers: Record<string, unknown>;
}): Promise<void> {
  try {
    await getDb()
      .insert(decisionShadow)
      .values({
        workspaceId: input.workspaceId,
        subjectKind: input.subjectKind,
        subjectId: input.subjectId,
        mode: input.mode,
        answers: input.answers,
      })
      .onConflictDoNothing({
        target: [
          decisionShadow.workspaceId,
          decisionShadow.subjectKind,
          decisionShadow.subjectId,
          decisionShadow.mode,
        ],
      });
  } catch (err) {
    // A shadow row is diagnostic only; losing one must never fail a scan.
    console.error("[decisions] shadow record failed", {
      subjectKind: input.subjectKind,
      error: err instanceof Error ? err.name : "unknown",
    });
  }
}

/**
 * Ask Clef-flash whether a preview is worth a paid full fetch. Returns null when
 * the decision layer is off or the call failed, so the caller hydrates as before.
 * In shadow mode the verdict and the spend it would have saved are recorded and
 * nothing is skipped.
 */
export async function prefilterHydration(input: {
  workspaceId: string;
  documentId: string;
  thread: string;
  profileSummary: string;
  hydrationCostUsd: number;
  signal?: AbortSignal;
}): Promise<{ skip: boolean } | null> {
  const mode = getDecisionMode();
  if (mode !== "shadow" && mode !== "on") return null;
  const result = await askClef({
    workspaceId: input.workspaceId,
    sourceKey: "reddit",
    action: "clef_prefilter",
    variant: "clef-flash",
    state: rankingState({ thread: input.thread, profileSummary: input.profileSummary }),
    questions: PREFILTER_QUESTIONS,
    signal: input.signal,
  });
  if (!result) return null;
  const answer = result.answers.worth_fetching;
  if (!answer || answer.type !== "noul") return null;
  const worth = answer.noul >= PREFILTER_THRESHOLD;
  await record({
    workspaceId: input.workspaceId,
    subjectKind: "document",
    subjectId: input.documentId,
    mode,
    answers: {
      worth_fetching: answer.noul,
      wouldSkip: !worth,
      savedUsd: worth ? 0 : input.hydrationCostUsd,
      model: result.model,
    },
  });
  return { skip: mode === "on" && !worth };
}

/**
 * Record Clef's ranking answers beside the current scorer. Never changes a score,
 * a status or the queue: this is measurement only.
 */
export async function recordRankingDecision(input: {
  workspaceId: string;
  opportunityId: string;
  thread: string;
  profileSummary: string;
  rulesText?: string | null;
  segments: string[];
  signal?: AbortSignal;
}): Promise<void> {
  const mode = getDecisionMode();
  if (mode !== "shadow" && mode !== "on") return;
  const result = await askClef({
    workspaceId: input.workspaceId,
    sourceKey: "opportunity",
    action: "clef_rank",
    variant: "clef",
    state: rankingState({
      thread: input.thread,
      profileSummary: input.profileSummary,
      rulesText: input.rulesText,
    }),
    questions: rankingQuestions(input.segments),
    signal: input.signal,
  });
  if (!result) return;
  const answers: Record<string, ClefAnswer | string> = { ...result.answers, model: result.model };
  await record({
    workspaceId: input.workspaceId,
    subjectKind: "opportunity",
    subjectId: input.opportunityId,
    mode,
    answers,
  });
}
