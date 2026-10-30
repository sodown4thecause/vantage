import { generateText, stepCountIs, type ModelMessage, type SystemModelMessage, type Tool } from "ai";

import { dataForSeoAvailable } from "@/lib/dataforseo/config";
import { runPaidCall } from "@/lib/providers/paid-call";
import {
  isTakoFilterRequest,
  normalizeTakoSearchOutput,
  takoSearchTool,
  takoWebResultCount,
  TakoSearchMeter,
} from "@/lib/research/tako";
import type { Intent } from "@/lib/seo-agent/classify";
import { buildEvidencePacket, type EvidencePacket, type EvidenceResultInput } from "@/lib/seo-agent/evidence";
import { costOfUsage, gatewayProvider } from "@/lib/seo-agent/models";
import { collectorPrompt, type PromptProfile } from "@/lib/seo-agent/prompt";
import { toolsForIntent } from "@/lib/seo-agent/tools";
import { followUpTools } from "@/lib/seo-agent/tools/follow-ups";
import { insightTools } from "@/lib/seo-agent/tools/insights";
import { researchTools } from "@/lib/seo-agent/tools/research";
import { addCard, addNotice, type ToolContext } from "@/lib/seo-agent/tools/shared";

const STEP_LIMIT = 6;
const COLLECT_MAX_OUTPUT_TOKENS = 1024;
const COLLECT_ESTIMATE_USD = 0.12;
const NOT_SET_UP_NOTICE = "SEO data is not set up yet.";

export type CollectInput = {
  workspaceId: string;
  question: string;
  history: ModelMessage[];
  intent: Intent;
  profile: PromptProfile;
  classificationHints: { domains: string[]; keywords: string[]; engines: string[] };
};

export type CollectDeps = {
  generateText?: typeof generateText;
};

export type CollectResult = {
  packet: EvidencePacket;
  finishReason: string | null;
};

type ObservedToolCall = { toolName?: unknown; toolCallId?: unknown; input?: unknown };
type ObservedToolResult = { toolName?: unknown; toolCallId?: unknown; output?: unknown };

function conversationContext(history: ModelMessage[]): string {
  return history
    .map((message) => {
      const content = typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content);
      return `${message.role}: ${content}`;
    })
    .join("\n");
}

function questionTurn(question: string, hints: CollectInput["classificationHints"]): string {
  return `${question}\nClassifier hints (data): ${JSON.stringify(hints)}`;
}

function chooseTools(ctx: ToolContext, intent: Intent): Record<string, Tool> {
  if (!dataForSeoAvailable()) {
    addNotice(ctx, NOT_SET_UP_NOTICE);
    return {
      ...followUpTools(ctx),
      ...researchTools(ctx),
      ...insightTools(ctx, ctx.insightRetriever),
      tako_search: takoSearchTool(),
    };
  }
  return toolsForIntent(intent, ctx);
}

function resultsFromContext(ctx: ToolContext): EvidenceResultInput[] {
  if (ctx.evidence) return ctx.evidence;
  return ctx.cards.map((card) => ({
    tool: card.tool,
    source: card.cached ? "cached" : "live",
    value: card.data,
  }));
}

/**
 * Runs the tool-capable collector model. Planner prose is discarded; only tool side effects and the evidence packet
 * are kept for the summarizer.
 */
export async function collectEvidence(
  input: CollectInput,
  ctx: ToolContext,
  modelId: string,
  opts: { signal?: AbortSignal; deps?: CollectDeps } = {},
): Promise<CollectResult> {
  const generate = opts.deps?.generateText ?? generateText;
  const tools = chooseTools(ctx, input.intent);
  // Collector must not own follow-ups; the summarizer writes those after the answer.
  const { suggest_follow_ups: _followUps, ...dataTools } = tools;
  const system: SystemModelMessage = {
    role: "system",
    content: collectorPrompt(input.profile),
    providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
  };
  const messages: ModelMessage[] = [
    ...input.history,
    { role: "user", content: questionTurn(input.question, input.classificationHints) },
  ];
  const takoMeter = new TakoSearchMeter(input.workspaceId, "seo", opts.signal);

  const value = await runPaidCall<CollectResult>({
    context: { workspaceId: input.workspaceId, sourceKey: "seo" },
    provider: "gateway",
    action: "seo_execute",
    estimateUsd: COLLECT_ESTIMATE_USD,
    signal: opts.signal,
  }, async () => {
    let result: Awaited<ReturnType<typeof generate>>;
    try {
      result = await generate({
        model: gatewayProvider()(modelId),
        system,
        messages,
        tools: dataTools,
        stopWhen: stepCountIs(STEP_LIMIT),
        maxRetries: 0,
        maxOutputTokens: COLLECT_MAX_OUTPUT_TOKENS,
        abortSignal: opts.signal,
        providerOptions: { anthropic: { effort: "medium" } },
        toolApproval: "tako_search" in dataTools
          ? { tako_search: (_input: unknown, { toolCallId }: { toolCallId: string }) => takoMeter.approve(toolCallId) }
          : undefined,
        prepareStep: ({ steps }) => {
          const calls = steps.flatMap((step) => step.toolCalls as unknown as ObservedToolCall[]);
          const takoCall = calls.findLast((call) => call.toolName === "tako_search");
          if (!takoCall) return undefined;
          const toolResults = steps.flatMap((step) => step.toolResults as unknown as ObservedToolResult[]);
          if (toolResults.some((item) => item.toolName === "web_research")) return undefined;
          const takoResult = toolResults.findLast((item) => item.toolName === "tako_search"
            && (typeof takoCall.toolCallId !== "string" || item.toolCallId === takoCall.toolCallId));
          if (!isTakoFilterRequest(takoCall.input) && takoWebResultCount(takoResult?.output) >= 3) return undefined;
          return { activeTools: ["web_research"], toolChoice: { type: "tool" as const, toolName: "web_research" } };
        },
        onStepFinish: async ({ toolResults }) => {
          for (const value of toolResults as unknown as ObservedToolResult[]) {
            if (value.toolName !== "tako_search") continue;
            if (typeof value.toolCallId === "string") await takoMeter.complete(value.toolCallId, value.output);
            const data = normalizeTakoSearchOutput(value.output);
            if (data.web_results.length > 0 || data.cards.length > 0) {
              addCard(ctx, { tool: "tako_search", title: "Tako Search", cached: false, data, sandbox: false });
            }
          }
        },
      });
    } finally {
      // A provider error or cancellation can end the call before onStepFinish settles a reserved Tako search.
      await takoMeter.settlePending();
    }
    const packet = buildEvidencePacket({
      question: input.question,
      conversationContext: conversationContext(input.history),
      profile: {
        productDomain: input.profile.productDomain,
        productName: input.profile.productName,
        competitor: input.profile.competitor,
        topic: input.profile.topic,
        description: input.profile.description,
        targetCustomer: input.profile.targetCustomer,
      },
      results: resultsFromContext(ctx),
      notices: ctx.notices,
      pendingApprovals: ctx.budget.planned,
    });
    const usage = result.usage;
    return {
      value: {
        packet,
        finishReason: typeof result.finishReason === "string" ? result.finishReason : null,
      },
      costUsd: costOfUsage(modelId, {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedInputTokens: usage.inputTokenDetails?.cacheReadTokens,
      }),
    };
  });

  return value;
}

/** Build a packet from approved-tool results already applied into the shared tool context. */
export function packetFromContext(
  ctx: ToolContext,
  question: string,
  history: ModelMessage[],
  profile: PromptProfile,
): EvidencePacket {
  return buildEvidencePacket({
    question,
    conversationContext: conversationContext(history),
    profile: {
      productDomain: profile.productDomain,
      productName: profile.productName,
      competitor: profile.competitor,
      topic: profile.topic,
      description: profile.description,
      targetCustomer: profile.targetCustomer,
    },
    results: resultsFromContext(ctx),
    notices: ctx.notices,
    pendingApprovals: ctx.budget.planned,
  });
}
