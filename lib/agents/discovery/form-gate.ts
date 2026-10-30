import type { LanguageModel } from "ai";

import { nameFromUrl } from "@/lib/agents/discovery/profile";
import type { SourceReview } from "@/lib/agents/discovery/proposals";
import { gateSource, createRelevanceJudge, RELEVANCE_ESTIMATE_USD, type RelevanceJudge } from "@/lib/agents/discovery/relevance-ai";
import { sourceKeyFor } from "@/lib/agents/discovery/budget";
import { reserveDiscoveryBudget } from "@/lib/agents/discovery/reservation";
import type { BudgetStore } from "@/lib/agents/discovery/store";
import { PaidCallDeniedError } from "@/lib/providers/paid-call";
import { gatewayProvider, seoModels } from "@/lib/seo-agent/models";

/*
 * The same source quality gate, for sources the profile form creates by itself. Before this, saving a profile always
 * created "Profile: Hacker News" from the owner's raw topics, which is how the 25 Oct source pulled in 12 unrelated
 * documents. Now the topics must pass the gate first: the free term pre-filter, then the AI relevance review while the
 * workspace still has budget. Saves draw on the small DAILY review pool, not the one-time initial discovery budget, so
 * tuning topics cannot use up a workspace's agent discovery. The cost is reserved in Neon first and settled after.
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
    if (model) judge = createRelevanceJudge({ model, modelId, workspaceId, sourceKey: sourceKeyFor("review") });
  }

  const profile = {
    productName: input.productUrl ? nameFromUrl(input.productUrl) : "",
    description: input.profile?.productDescription ?? "",
    category: "",
    audience: input.profile?.targetCustomer ?? "",
    differentiators: [],
    competitors: input.profile?.competitors ?? [],
    // The topics are deliberately NOT part of the vocabulary: a query must echo the product's own description, audience,
    // name or competitors, otherwise every non-generic topic would trivially match itself.
    keywords: [],
  };
  const source = {
    sourceType: "hn" as const, name: "Profile sources", queries: input.topics.slice(0, 5),
    rationale: "Topics from the saved profile.", relevanceScore: 1,
  };

  // Reserved lazily, only if the free pre-filter passes, and settled with the real cost afterwards.
  let settle: ((actualUsd: number) => Promise<void>) | undefined;
  let actual = 0;
  let started = false;
  try {
    return await gateSource(profile, source, {
      // The owner's own topic list: at least half must fit, because the form builds default sources from the whole list.
      minQueryShare: 0.5,
      judge: judge && (async (...args) => { started = true; return judge(...args); }),
      canAfford: async () => {
        try {
          const reservation = await reserveDiscoveryBudget(workspaceId, "review", { store: deps.store, env, now: deps.now });
          settle = reservation.settle;
          return true;
        } catch (error) {
          // Only a genuinely spent budget degrades to the term match. A store error fails closed (the caller creates nothing).
          if (error instanceof PaidCallDeniedError && error.code === "budget_exhausted") return false;
          throw error;
        }
      },
      onCost: (usd) => { actual += usd; },
    });
  } finally {
    // A review that started but failed was still charged by runPaidCall at its estimate; never refund that.
    await settle?.(actual > 0 ? actual : started ? RELEVANCE_ESTIMATE_USD : 0);
  }
}
