import type { Tool } from "ai";

import type { Intent } from "@/lib/seo-agent/classify";
import { backlinkTools } from "@/lib/seo-agent/tools/backlinks";
import { followUpTools } from "@/lib/seo-agent/tools/follow-ups";
import { geoTools } from "@/lib/seo-agent/tools/geo";
import { insightTools } from "@/lib/seo-agent/tools/insights";
import { keywordTools } from "@/lib/seo-agent/tools/keywords";
import { serpTools } from "@/lib/seo-agent/tools/serp";
import { researchTools } from "@/lib/seo-agent/tools/research";
import { takoSearchTool } from "@/lib/research/tako";
import type { ToolContext } from "@/lib/seo-agent/tools/shared";

type DataIntent = Exclude<Intent, "all" | "concept" | "out_of_scope">;

/** Spec 4.2: which data tools each intent may call. Follow-ups are added to every set. */
const TOOLS_BY_INTENT: Record<DataIntent, string[]> = {
  backlinks: ["backlink_summary", "referring_domains", "backlink_gap", "anchors", "tako_search", "web_research", "linkup_fetch", "search_insights"],
  keywords: ["keyword_ideas", "keyword_overview", "ranked_keywords", "competitor_domains", "keyword_gap", "tako_search", "web_research", "linkup_fetch", "search_insights"],
  serp: ["google_serp", "keyword_overview", "tako_search", "web_research", "linkup_fetch", "search_insights"],
  geo_visibility: ["llm_response", "ai_keyword_volume", "google_serp", "tako_search", "web_research", "linkup_fetch", "search_insights"],
  content: ["keyword_ideas", "keyword_overview", "google_serp", "ranked_keywords", "tako_search", "web_research", "linkup_fetch", "search_insights"],
};

/** Used when classification failed: every data tool named by any intent, each once, in first-seen order. */
const ALL_DATA_TOOLS = [...new Set(Object.values(TOOLS_BY_INTENT).flat())];

/**
 * The tools one question may use. Concept and out-of-scope answers use none; their follow-ups come from a separate
 * classifier call. `search_insights` is included only when a real retriever is on the tool context.
 */
export function toolsForIntent(intent: Intent, ctx: ToolContext): Record<string, Tool> {
  if (intent === "concept" || intent === "out_of_scope") return {};
  const names = intent === "all" ? ALL_DATA_TOOLS : TOOLS_BY_INTENT[intent];
  const available: Record<string, Tool> = {
    ...backlinkTools(ctx),
    ...keywordTools(ctx),
    ...serpTools(ctx),
    ...geoTools(ctx),
    ...researchTools(ctx),
    ...insightTools(ctx, ctx.insightRetriever),
    tako_search: takoSearchTool(),
    ...followUpTools(ctx),
  };
  const selected: Record<string, Tool> = {};
  for (const name of [...names, "suggest_follow_ups"]) {
    const tool = available[name];
    if (tool) selected[name] = tool;
  }
  return selected;
}
