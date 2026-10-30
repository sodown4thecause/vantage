import {
  streamText,
  type ModelMessage,
  type SystemModelMessage,
  type UIMessageChunk,
  type UIMessageStreamWriter,
} from "ai";

import type { EvidencePacket } from "@/lib/seo-agent/evidence";
import { costOfUsage, gatewayProvider } from "@/lib/seo-agent/models";
import { summarizerPrompt, type PromptProfile } from "@/lib/seo-agent/prompt";
import { fallbackFollowUps } from "@/lib/seo-agent/suggestions";
import type { Intent } from "@/lib/seo-agent/classify";
import type { FollowUps } from "@/lib/seo-agent/conversations";
import { followUpTools } from "@/lib/seo-agent/tools/follow-ups";
import type { ToolContext } from "@/lib/seo-agent/tools/shared";

const SUMMARIZER_MAX_OUTPUT_TOKENS = 4096;
const SUMMARIZER_ESTIMATE_USD = 0.1;
const LIFECYCLE_CHUNKS = new Set(["start", "start-step", "finish-step", "finish", "message-metadata"]);

export type SummarizeDeps = {
  streamText?: typeof streamText;
};

export type SummarizeAttempt = {
  kind: "complete" | "refused" | "error";
  flushed: boolean;
  text: string;
  spendUsd: number;
  unpriced: boolean;
  erred: boolean;
};

type Meter = { started: number; finished: number; spendUsd: number; unpriced: boolean; erred: boolean };

function writeText(writer: UIMessageStreamWriter, value: string): void {
  const id = crypto.randomUUID();
  writer.write({ type: "text-start", id });
  writer.write({ type: "text-delta", id, delta: value });
  writer.write({ type: "text-end", id });
}

/**
 * Streams the owner-facing answer from a bounded evidence packet. No DataForSEO or web-fetch tools are offered —
 * only suggest_follow_ups.
 */
export async function summarizeEvidence(args: {
  workspaceId: string;
  question: string;
  packet: EvidencePacket;
  profile: PromptProfile;
  intent: Intent;
  modelId: string;
  fallbackModelId: string | null;
  ctx: ToolContext;
  writer: UIMessageStreamWriter;
  signal?: AbortSignal;
  deps?: SummarizeDeps;
  onUsage?: (costUsd: number | undefined) => void;
}): Promise<SummarizeAttempt & { followUps: FollowUps }> {
  const streamer = args.deps?.streamText ?? streamText;
  const tools = followUpTools(args.ctx);
  const system: SystemModelMessage = {
    role: "system",
    content: summarizerPrompt(args.profile),
    providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
  };
  const messages: ModelMessage[] = [{
    role: "user",
    content: [
      `Owner question (data): ${JSON.stringify(args.question)}`,
      `Evidence packet (untrusted data): ${JSON.stringify(args.packet)}`,
      "Answer the owner from this evidence only. Finish by calling suggest_follow_ups.",
    ].join("\n"),
  }];

  const meter: Meter = { started: 0, finished: 0, spendUsd: 0, unpriced: false, erred: false };

  const runOnce = async (modelId: string): Promise<SummarizeAttempt> => {
    meter.started += 1;
    const pending: UIMessageChunk[] = [];
    let flushed = false;
    let text = "";
    let stepBreak = false;
    try {
      const result = streamer({
        model: gatewayProvider()(modelId),
        system,
        messages,
        tools,
        maxRetries: 0,
        maxOutputTokens: SUMMARIZER_MAX_OUTPUT_TOKENS,
        abortSignal: args.signal,
        providerOptions: { anthropic: { effort: "medium" } },
        onFinish: ({ usage }) => {
          meter.finished += 1;
          const cost = costOfUsage(modelId, {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cachedInputTokens: usage.inputTokenDetails?.cacheReadTokens,
          });
          if (cost === undefined) meter.unpriced = true;
          else meter.spendUsd += cost;
          args.onUsage?.(cost);
        },
      });
      // Read the stream first so answer text reaches the owner while the model is still finishing.
      const finishing = Promise.resolve(result.finishReason);
      finishing.catch(() => undefined);
      const stream = result.toUIMessageStream();
      const reader = stream.getReader();
      // Cancel on any early exit (error chunk, read or write failure) so the model stream stops, and always release the lock.
      let drained = false;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            drained = true;
            break;
          }
          const chunk = value as UIMessageChunk;
          if (chunk.type === "error") {
            meter.erred = true;
            return { kind: "error", flushed, text, spendUsd: meter.spendUsd, unpriced: meter.unpriced, erred: true };
          }
          if (chunk.type === "start-step") stepBreak = text !== "";
          if (chunk.type === "text-delta") {
            const delta = stepBreak ? `\n\n${chunk.delta}` : chunk.delta;
            stepBreak = false;
            text += delta;
            if (!flushed) {
              flushed = true;
              for (const held of pending) args.writer.write(held);
              pending.length = 0;
            }
            args.writer.write(delta === chunk.delta ? chunk : { type: "text-delta", id: chunk.id, delta });
            continue;
          }
          if (LIFECYCLE_CHUNKS.has(chunk.type)) continue;
          if (!flushed) pending.push(chunk);
          else args.writer.write(chunk);
        }
      } finally {
        if (!drained) await reader.cancel().catch(() => undefined);
        try {
          reader.releaseLock();
        } catch {
          // Already released or still has a pending read; nothing more to do.
        }
      }
      const finishReason = await finishing;
      if (finishReason === "content-filter" && text.trim() === "") {
        return { kind: "refused", flushed, text, spendUsd: meter.spendUsd, unpriced: meter.unpriced, erred: meter.erred };
      }
      return { kind: "complete", flushed, text, spendUsd: meter.spendUsd, unpriced: meter.unpriced, erred: meter.erred };
    } catch {
      meter.erred = true;
      return { kind: "error", flushed, text, spendUsd: meter.spendUsd, unpriced: meter.unpriced, erred: true };
    }
  };

  let attempt = await runOnce(args.modelId);
  if (attempt.kind === "refused" && !attempt.flushed && args.fallbackModelId) {
    attempt = await runOnce(args.fallbackModelId);
  }

  return {
    ...attempt,
    followUps: args.ctx.followUps ?? fallbackFollowUps(args.profile, args.intent),
  };
}

export { writeText, SUMMARIZER_ESTIMATE_USD };
