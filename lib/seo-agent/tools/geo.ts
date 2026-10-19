import { tool } from "ai";
import { z } from "zod";

import {
  type LlmEngine,
  type LlmResponse,
  LLM_ENGINES,
  fetchAiKeywordVolume,
  fetchLlmResponse,
  peekAiKeywordVolume,
  peekLlmResponse,
  resolveLlmModel,
} from "@/lib/dataforseo/ai-optimization";
import { geoAlwaysAsk } from "@/lib/seo-agent/budget";
import {
  type ToolContext,
  addCard,
  addNotice,
  failureCode,
  gateOptions,
  keywordLabel,
  keywordsField,
  normalizeKeywords,
  runGated,
  settleAll,
} from "@/lib/seo-agent/tools/shared";

const PROMPT_MAX_CHARS = 500;
/** An engine answer costs two credits. */
const LLM_CREDITS = 2;

const ENGINE_LABELS: Record<LlmEngine, string> = {
  chat_gpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  perplexity: "Perplexity",
};

/**
 * Asks each requested engine the prompt. Cached answers are served free; the rest share one reservation of two credits
 * each, and a failed engine gives its two credits back. Engines with no model are skipped with a notice.
 */
async function askEngines(ctx: ToolContext, rawPrompt: string, requested: LlmEngine[]): Promise<unknown> {
  const prompt = rawPrompt.trim();
  if (!prompt || prompt.length > PROMPT_MAX_CHARS) return { error: "invalid_prompt" };
  const wanted = new Set<string>(requested);
  const engines = LLM_ENGINES.filter((engine) => wanted.has(engine));
  if (engines.length === 0) return { error: "invalid_engines" };
  const input = { prompt, engines };

  const models = await Promise.all(engines.map((engine) => resolveLlmModel(engine).catch(() => null)));
  const available: { engine: LlmEngine; model: string }[] = [];
  engines.forEach((engine, i) => {
    const model = models[i];
    if (model) available.push({ engine, model });
    else addNotice(ctx, `${ENGINE_LABELS[engine]} is not available right now, so it was skipped.`);
  });
  if (available.length === 0) return { error: "unavailable" };

  const answers = new Map<LlmEngine, LlmResponse>();
  let peeked: (LlmResponse | null)[];
  try {
    peeked = await Promise.all(available.map(({ engine, model }) => peekLlmResponse(engine, prompt, model, ctx.brandDomains)));
  } catch {
    return { error: "failed" };
  }
  const misses: { engine: LlmEngine; model: string }[] = [];
  available.forEach((item, i) => {
    const hit = peeked[i];
    if (hit) {
      answers.set(item.engine, hit);
      addCard(ctx, { tool: "llm_response", title: `AI answer — ${ENGINE_LABELS[item.engine]}`, cached: true, data: hit });
    } else {
      misses.push(item);
    }
  });
  const inOrder = () => available.flatMap(({ engine }) => {
    const answer = answers.get(engine);
    return answer ? [answer] : [];
  });
  if (misses.length === 0) return { answers: inOrder() };

  const credits = misses.length * LLM_CREDITS;
  if (ctx.budget.tryReserve({ tool: "llm_response", input, credits }, geoAlwaysAsk()) === "ask") {
    return { status: "needs_approval", credits };
  }

  const results = await settleAll(misses, ({ engine, model }) =>
    fetchLlmResponse(ctx.workspaceId, engine, prompt, model, ctx.brandDomains, gateOptions(ctx)));
  let refund = 0;
  let failed: string | null = null;
  for (const result of results) {
    if (!result.ok) {
      refund += LLM_CREDITS;
      if (failed === null) failed = failureCode(ctx, result.error);
      continue;
    }
    if (result.value.cached) refund += LLM_CREDITS;
    answers.set(result.item.engine, result.value.value);
    addCard(ctx, {
      tool: "llm_response",
      title: `AI answer — ${ENGINE_LABELS[result.item.engine]}`,
      cached: result.value.cached,
      data: result.value.value,
    });
  }
  ctx.budget.refund(refund);
  return failed === null ? { answers: inOrder() } : { answers: inOrder(), error: failed };
}

export function geoTools(ctx: ToolContext) {
  return {
    llm_response: tool({
      description: [
        "Ask AI assistants (ChatGPT, Claude, Gemini, Perplexity) one prompt and return their answers, citations and whether",
        "the owner's brand appears. Costs two credits per engine not already cached. GEO calls usually need owner approval.",
      ].join(" "),
      inputSchema: z.object({
        prompt: z.string().trim().min(1).max(PROMPT_MAX_CHARS),
        engines: z.array(z.enum(LLM_ENGINES)).min(1).max(LLM_ENGINES.length),
      }).strict(),
      strict: true,
      execute: async ({ prompt, engines }) => askEngines(ctx, prompt, engines),
    }),

    ai_keyword_volume: tool({
      description: "Search volume of keywords inside AI assistant answers, as opposed to Google search volume.",
      inputSchema: z.object({ keywords: keywordsField }).strict(),
      strict: true,
      execute: async ({ keywords }) => {
        const list = normalizeKeywords(keywords);
        if (!list) return { error: "invalid_keywords" };
        return runGated(ctx, {
          tool: "ai_keyword_volume",
          title: `AI search volume — ${keywordLabel(list)}`,
          input: { keywords: list },
          credits: 1,
          peek: () => peekAiKeywordVolume(list),
          fetch: () => fetchAiKeywordVolume(ctx.workspaceId, list, gateOptions(ctx)),
        });
      },
    }),
  };
}
