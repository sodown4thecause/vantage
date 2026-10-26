import type { LanguageModel } from "ai";

import { nameFromUrl } from "@/lib/agents/discovery/profile";
import type { SourceReview } from "@/lib/agents/discovery/proposals";
import { gateSource, createRelevanceJudge, type RelevanceJudge } from "@/lib/agents/discovery/relevance-ai";
import { DISCOVERY_SOURCE_KEY } from "@/lib/agents/discovery/budget";
import { reserveDiscoveryBudget } from "@/lib/agents/discovery/reservation";
import type { BudgetStore } from "@/lib/agents/discovery/store";
import { gatewayProvider, seoModels } from "@/lib/seo-agent/models";

/*
 * The same source quality gate, for sources the profile form creates by itself. Before this, saving a profile always
 * created "Profile: Hacker News" from the owner's raw topics, which is how the 25 Oct source pulled in 12 unrelated
 * documents. Now the topics must pass the gate first: the free term pre-filter, then the AI relevance review while the
 * workspace still has discovery budget. The review's cost is reserved in Neon first and settled after, like a run.
 */

export type FormGateDeps = {
  judge?: RelevanceJudge;
  model?: LanguageModel;
  modelId?: string;
  store?: BudgetStore;
  env?: Record<string, string | undefined>;
  now?: Date;
};

export type FormProfile = { productDescription: string; targetCustomer: string; competitors: string[] };

export async function gateProfileTopics(
  workspaceId: string,
  input: { topics: string[]; productUrl?: string; profile?: FormProfile },
  deps: FormGateDeps = {},
): Promise<SourceReview> {
  const env = deps.env ?? process.env;
  let judge = deps.judge;
  if (!judge) {
    let model = deps.model;
    let modelId = deps.modelId;
    if (!model) {
      const models = seoModels(env);
      if (models) { model = gatewayProvider(env)(models.executor); modelId = models.executor; }
    }
    if (model) judge = createRelevanceJudge({ model, modelId, workspaceId, sourceKey: DISCOVERY_SOURCE_KEY });
  }

  const profile = {
    productName: input.productUrl ? nameFromUrl(input.productUrl) : "",
    description: input.profile?.productDescription ?? "",
    category: "",
    audience: input.profile?.targetCustomer ?? "",
    differentiators: [],
    competitors: input.profile?.competitors ?? [],
    // The owner's own topics are the product's vocabulary, so a topic is "generic" only if it names nothing but common words.
    keywords: input.topics,
  };
  const source = {
    sourceType: "hn" as const, name: "Profile sources", queries: input.topics.slice(0, 5),
    rationale: "Topics from the saved profile.", relevanceScore: 1,
  };

  // Reserved lazily, only if the free pre-filter passes, and settled with the real cost afterwards.
  let settle: ((actualUsd: number) => Promise<void>) | undefined;
  let actual = 0;
  try {
    return await gateSource(profile, source, {
      judge,
      canAfford: async () => {
        try {
          const reservation = await reserveDiscoveryBudget(workspaceId, "initial", { store: deps.store, env, now: deps.now });
          settle = reservation.settle;
          return true;
        } catch { return false; }
      },
      onCost: (usd) => { actual += usd; },
    });
  } finally {
    await settle?.(actual);
  }
}
