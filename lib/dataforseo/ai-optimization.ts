import { FRESHNESS_SECONDS } from "@/lib/dataforseo/cache";
import { listLlmModels, peekDataForSeo, runDataForSeo } from "@/lib/dataforseo/gate";
import { type DataForSeoCall, SEO_DEFAULTS, itemsOf, num, recordOf, recordsOf, str } from "@/lib/dataforseo/shared";

export const LLM_ENGINES = ["chat_gpt", "claude", "gemini", "perplexity"] as const;
export type LlmEngine = (typeof LLM_ENGINES)[number];

export type LlmCitation = { title: string | null; url: string };

/** What an engine said. Contains nothing about a particular brand, so it is safe in the shared cache. */
export type LlmAnswer = { engine: LlmEngine; model: string | null; text: string; citations: LlmCitation[] };

export type LlmResponse = LlmAnswer & { mentionsBrand: boolean };

type GateOptions = NonNullable<Parameters<typeof runDataForSeo>[1]>;

const PROMPT_CAP = 500;
const TEXT_CAP = 4_000;
// A brand name shorter than this matches too much text to mean anything.
const BRAND_NAME_MIN = 3;
// Labels that sit between the name and a country code, as in example.co.uk, so the name is the label before them.
const SECOND_LEVEL_LABELS = new Set(["ac", "co", "com", "edu", "gov", "net", "org"]);

/**
 * The model to ask an engine: the DATAFORSEO_LLM_MODEL_<ENGINE> override when set, else the first model that supports
 * web search, else the first model. Null when the engine offers none.
 */
export async function resolveLlmModel(engine: LlmEngine, env: Record<string, string | undefined> = process.env): Promise<string | null> {
  const override = env[`DATAFORSEO_LLM_MODEL_${engine.toUpperCase()}`]?.trim();
  if (override) return override;
  const models = await listLlmModels(engine);
  const pick = models.find((model) => model.webSearch) ?? models[0];
  return pick?.modelName ?? null;
}

export function llmResponseTask(engine: LlmEngine, prompt: string, model: string): DataForSeoCall {
  return {
    endpoint: `/v3/ai_optimization/${engine}/llm_responses/live`,
    task: { user_prompt: prompt.slice(0, PROMPT_CAP), model_name: model, web_search: true },
    estimateUsd: 0.1,
  };
}

/** Only http and https links are kept, so a provider URL can never become a javascript: link. */
function httpUrl(value: unknown): string | null {
  const url = str(value);
  if (!url) return null;
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/** The brand-independent part of an answer: text, citations and the model name. */
export function trimLlmAnswer(result: unknown[], engine: LlmEngine): LlmAnswer {
  const texts: string[] = [];
  const citations: LlmCitation[] = [];
  for (const section of itemsOf(result).flatMap((item) => recordsOf(item.sections))) {
    const text = str(section.text);
    if (text) texts.push(text);
    for (const annotation of recordsOf(section.annotations)) {
      const url = httpUrl(annotation.url);
      if (url) citations.push({ title: str(annotation.title), url });
    }
  }
  const model = str(recordOf(result[0]).model_name);
  return {
    engine,
    model: model ? model : null,
    text: texts.join("\n").slice(0, TEXT_CAP),
    citations,
  };
}

/**
 * Terms that identify a brand: each domain, and its name without the TLD (pinecone from pinecone.io, example from
 * blog.example.co.uk). Names shorter than BRAND_NAME_MIN are left out.
 */
export function brandTerms(brandDomains: string[]): string[] {
  const terms = new Set<string>();
  for (const raw of brandDomains) {
    const domain = raw.trim().toLowerCase().replace(/^www\./, "");
    if (!domain) continue;
    terms.add(domain);
    const labels = domain.split(".");
    if (labels.length < 2) continue;
    let name = labels[labels.length - 2];
    if (SECOND_LEVEL_LABELS.has(name) && labels.length >= 3) name = labels[labels.length - 3];
    if (name.length >= BRAND_NAME_MIN) terms.add(name);
  }
  return [...terms];
}

/** True when a brand term appears, case-insensitively, in the text or in any citation URL. */
export function brandMentioned(answer: Pick<LlmAnswer, "text" | "citations">, brandDomains: string[]): boolean {
  const terms = brandTerms(brandDomains);
  if (terms.length === 0) return false;
  const haystack = [answer.text, ...answer.citations.map((citation) => citation.url)].join("\n").toLowerCase();
  return terms.some((term) => haystack.includes(term));
}

function withBrand(answer: LlmAnswer, brandDomains: string[]): LlmResponse {
  return { ...answer, mentionsBrand: brandMentioned(answer, brandDomains) };
}

/** The full response for one caller: the answer plus that caller's brand verdict. */
export function trimLlmResponse(result: unknown[], brandDomains: string[], engine: LlmEngine): LlmResponse {
  return withBrand(trimLlmAnswer(result, engine), brandDomains);
}

/**
 * One engine answer through the spend gate. The cache holds the brand-independent answer, shared by every workspace,
 * so the brand verdict is computed here for each caller, cache hit or not.
 */
export async function fetchLlmResponse(
  workspaceId: string,
  engine: LlmEngine,
  prompt: string,
  model: string,
  brandDomains: string[],
  opts?: GateOptions,
): Promise<{ value: LlmResponse; cached: boolean }> {
  const call = llmResponseTask(engine, prompt, model);
  const { value, cached } = await runDataForSeo<unknown, LlmAnswer>({
    workspaceId,
    endpoint: call.endpoint,
    task: call.task,
    freshnessSeconds: FRESHNESS_SECONDS.llm,
    estimateUsd: call.estimateUsd,
    trim: (result) => trimLlmAnswer(result, engine),
  }, opts);
  return { value: withBrand(value, brandDomains), cached };
}

/** Cache-only read of an engine answer. Never spends. */
export async function peekLlmResponse(
  engine: LlmEngine,
  prompt: string,
  model: string,
  brandDomains: string[],
): Promise<LlmResponse | null> {
  const call = llmResponseTask(engine, prompt, model);
  const answer = await peekDataForSeo<LlmAnswer>(call.endpoint, call.task, FRESHNESS_SECONDS.llm);
  return answer ? withBrand(answer, brandDomains) : null;
}

export function aiKeywordVolumeTask(keywords: string[]): DataForSeoCall {
  return {
    endpoint: "/v3/ai_optimization/ai_keyword_data/keywords_search_volume/live",
    task: { keywords, ...SEO_DEFAULTS },
    estimateUsd: 0.05,
  };
}

export function trimAiKeywordVolume(result: unknown[]): { keyword: string; aiSearchVolume: number }[] {
  return recordsOf(result).flatMap((row) => {
    const keyword = str(row.keyword);
    if (!keyword) return [];
    return [{ keyword, aiSearchVolume: num(row.ai_search_volume) }];
  });
}

export function fetchAiKeywordVolume(workspaceId: string, keywords: string[], opts?: GateOptions) {
  const call = aiKeywordVolumeTask(keywords);
  return runDataForSeo<unknown, { keyword: string; aiSearchVolume: number }[]>({
    workspaceId,
    endpoint: call.endpoint,
    task: call.task,
    freshnessSeconds: FRESHNESS_SECONDS.aiKeywords,
    estimateUsd: call.estimateUsd,
    trim: trimAiKeywordVolume,
  }, opts);
}

/** Cache-only read of AI keyword volume. Never spends. */
export function peekAiKeywordVolume(keywords: string[]) {
  const call = aiKeywordVolumeTask(keywords);
  return peekDataForSeo<{ keyword: string; aiSearchVolume: number }[]>(call.endpoint, call.task, FRESHNESS_SECONDS.aiKeywords);
}
