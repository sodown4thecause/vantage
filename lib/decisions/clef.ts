import { z } from "zod";

import { withObservedSpan } from "@/lib/analytics/spans.mjs";
import { getAi, type AiBinding } from "@/lib/cf/env";
import { runPaidCall } from "@/lib/providers/paid-call";

export const CLEF_MODEL = "@cf/cloudflare/clef";
export const CLEF_FLASH_MODEL = "@cf/cloudflare/clef-flash";

/** USD per million input tokens. Clef does not bill output tokens. */
const CLEF_INPUT_USD_PER_MTOK = 0.24;
const DEFAULT_TIMEOUT_MS = 8_000;
/** Clef reads the state as text; four characters per token is the usual estimate. */
const CHARS_PER_TOKEN = 4;

export type ClefQuestion =
  | { type: "noul"; instructions: string }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

export type ClefAnswer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: "score"; score: number; confidence: number; legend: Record<string, string>; probabilities: Record<string, number> };

export type ClefResult = {
  model: string;
  answers: Record<string, ClefAnswer>;
  inputTokens: number;
};

const probability = z.number().min(0).max(1);
const probabilities = z.record(z.string(), probability);

const answerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("noul"), noul: probability }),
  z.object({
    type: z.literal("choice"),
    choice: z.string().min(1),
    confidence: probability.optional(),
    probabilities: probabilities.optional(),
  }),
  z.object({
    type: z.literal("score"),
    score: z.number().finite(),
    confidence: probability.optional(),
    legend: z.record(z.string(), z.string()).optional(),
    probabilities: probabilities.optional(),
  }),
]);

const responseSchema = z.object({
  model: z.string().optional(),
  answers: z.record(z.string(), answerSchema),
  usage: z.object({ input_tokens: z.number().finite().optional() }).optional(),
});

/** Fills the optional fields so callers always see the same shape. */
function normalise(answer: z.infer<typeof answerSchema>): ClefAnswer {
  if (answer.type === "noul") return { type: "noul", noul: answer.noul };
  if (answer.type === "choice") {
    return {
      type: "choice",
      choice: answer.choice,
      confidence: answer.confidence ?? answer.probabilities?.[answer.choice] ?? 0,
      probabilities: answer.probabilities ?? {},
    };
  }
  return {
    type: "score",
    score: answer.score,
    confidence: answer.confidence ?? 0,
    legend: answer.legend ?? {},
    probabilities: answer.probabilities ?? {},
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Clef timed out")), ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/** Estimated input tokens for a state, floored at one so the reservation is always positive. */
export function estimateClefTokens(state: string): number {
  return Math.max(1, Math.ceil(new TextEncoder().encode(state).length / CHARS_PER_TOKEN));
}

export function estimateClefUsd(state: string): number {
  return (estimateClefTokens(state) * CLEF_INPUT_USD_PER_MTOK) / 1_000_000;
}

/**
 * Ask Clef typed questions about a state. Returns null on any failure — a missing
 * binding, a timeout, a malformed answer or a denied paid call — so the caller's
 * existing scorer stands. Only cancellation propagates.
 */
export async function askClef(input: {
  workspaceId: string;
  sourceKey: string;
  action: string;
  /** `clef` for precision, `clef-flash` for the hot path. */
  variant: "clef" | "clef-flash";
  state: string;
  questions: Record<string, ClefQuestion>;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Injected binding for CLI harnesses; defaults to the Worker's AI binding. */
  ai?: AiBinding | null;
}): Promise<ClefResult | null> {
  input.signal?.throwIfAborted();
  const ai = input.ai ?? await getAi();
  if (!ai) return null;
  const modelId = input.variant === "clef" ? CLEF_MODEL : CLEF_FLASH_MODEL;
  const estimateUsd = estimateClefUsd(input.state);
  try {
    return await runPaidCall<ClefResult>({
      context: { workspaceId: input.workspaceId, sourceKey: input.sourceKey },
      provider: "workers_ai",
      action: input.action,
      estimateUsd,
      signal: input.signal,
    }, async () => {
      const response = await withTimeout(
        withObservedSpan(
          "ai.decision",
          { workspaceId: input.workspaceId, source: input.sourceKey, provider: "workers_ai" },
          () => ai.run(modelId, { model: input.variant, state: input.state, questions: input.questions },
            { gateway: { id: "vantage" } }),
        ),
        input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        input.signal,
      );
      const parsed = responseSchema.safeParse(response);
      if (!parsed.success) throw new Error("Clef returned an unexpected answer shape");
      const answers: Record<string, ClefAnswer> = {};
      for (const [name, answer] of Object.entries(parsed.data.answers)) answers[name] = normalise(answer);
      const inputTokens = parsed.data.usage?.input_tokens ?? estimateClefTokens(input.state);
      return {
        value: { model: parsed.data.model ?? modelId, answers, inputTokens },
        costUsd: (inputTokens * CLEF_INPUT_USD_PER_MTOK) / 1_000_000,
      };
    });
  } catch (error) {
    if (input.signal?.aborted) throw error;
    // Only the error class is logged: exception text can embed request details.
    console.error("[clef] decision call failed", {
      action: input.action,
      error: error instanceof Error ? error.name : "unknown",
    });
    return null;
  }
}
