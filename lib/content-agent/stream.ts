import { createAgentUIStreamResponse, type UIMessage } from "ai";

import { runPaidCall } from "@/lib/providers/paid-call";
import { upsertContentAssistantMessage } from "./repository";
import type { ContentAgent } from "./agent";
import { contentAgentEstimateUsd, contentUsageCost, type ContentAgentModels } from "./models";
import type { ContentMessageStatus } from "./contracts";

const CONTENT_SOURCE_KEY = "content";

type PaidOutcome = { costUsd?: number; error?: Error };

function textOf(message: UIMessage): string {
  return message.parts.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n\n");
}

function statusOf(outcome: "completed" | "failed" | "aborted" | "unknown"): ContentMessageStatus {
  if (outcome === "completed") return "complete";
  if (outcome === "failed") return "failed";
  return "incomplete";
}

/** Streams a ToolLoopAgent response while holding one provider reservation for the whole agent turn. */
export async function createContentAgentResponse(args: {
  workspaceId: string;
  threadId: string;
  agent: ContentAgent;
  messages: UIMessage[];
  abortSignal: AbortSignal;
  models: ContentAgentModels;
}): Promise<Response> {
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  let deliver!: (outcome: PaidOutcome) => void;
  const finished = new Promise<PaidOutcome>((resolve) => { deliver = resolve; });
  let settled = false;
  const settle = (outcome: PaidOutcome) => {
    if (settled) return;
    settled = true;
    deliver(outcome);
  };

  const paidCall = runPaidCall<void>({
    context: { workspaceId: args.workspaceId, sourceKey: CONTENT_SOURCE_KEY },
    provider: "gateway",
    action: "content_agent",
    estimateUsd: contentAgentEstimateUsd(),
    signal: args.abortSignal,
  }, async () => {
    markStarted();
    const outcome = await finished;
    return outcome.error === undefined
      ? { value: undefined, costUsd: outcome.costUsd }
      : { error: outcome.error, costUsd: outcome.costUsd };
  });
  // Attach a rejection handler now; the paid operation settles after the response starts streaming.
  void paidCall.catch((error: unknown) => {
    if (!settled) settle({ error: error instanceof Error ? error : new Error("Content agent failed") });
  });
  await Promise.race([started, paidCall]);

  const messageId = crypto.randomUUID();
  let steps = 0;
  let priced = true;
  let spendUsd = 0;
  const measuredCost = () => steps > 0 && priced ? spendUsd : undefined;
  const abort = () => settle({ error: new Error("Content stream stopped"), costUsd: measuredCost() });
  args.abortSignal.addEventListener("abort", abort, { once: true });
  if (args.abortSignal.aborted) abort();

  try {
    return await createAgentUIStreamResponse({
      agent: args.agent,
      uiMessages: args.messages,
      abortSignal: args.abortSignal,
      generateMessageId: () => messageId,
      messageMetadata: () => ({ threadId: args.threadId }),
      onStepEnd: ({ usage }) => {
        steps += 1;
        const cost = contentUsageCost(args.models.model, usage);
        if (cost === undefined) priced = false;
        else spendUsd += cost;
      },
      onUIMessageStepEnd: async ({ responseMessage }) => {
        await upsertContentAssistantMessage({
          id: messageId,
          workspaceId: args.workspaceId,
          threadId: args.threadId,
          content: textOf(responseMessage),
          status: "streaming",
        });
      },
      onEnd: async ({ responseMessage, outcome }) => {
        const status = statusOf(outcome.status);
        try {
          await upsertContentAssistantMessage({
            id: messageId,
            workspaceId: args.workspaceId,
            threadId: args.threadId,
            content: textOf(responseMessage),
            status,
          });
          settle(status === "complete"
            ? { costUsd: measuredCost() }
            : { error: new Error("Content agent turn did not complete"), costUsd: measuredCost() });
        } catch (error) {
          settle({ error: error instanceof Error ? error : new Error("Content message could not be saved"), costUsd: measuredCost() });
          throw error;
        } finally {
          args.abortSignal.removeEventListener("abort", abort);
        }
      },
    });
  } catch (error) {
    settle({ error: error instanceof Error ? error : new Error("Content agent failed"), costUsd: measuredCost() });
    args.abortSignal.removeEventListener("abort", abort);
    throw error;
  }
}
