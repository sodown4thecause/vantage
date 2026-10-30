import { tool, type Tool } from "ai";
import { z } from "zod";

import {
  createInsightRetriever,
  normalizeInsightPassages,
  type InsightRetriever,
} from "@/lib/seo-agent/insights";
import {
  addCard,
  addNotice,
  forModelData,
  type ToolContext,
} from "@/lib/seo-agent/tools/shared";

const QUERY_MAX = 500;

/**
 * Registers `search_insights` only when a real retriever is provided or configured.
 * Unavailable knowledge bases are not advertised as a failing tool.
 */
export function insightTools(
  ctx: ToolContext,
  retriever: InsightRetriever | null = createInsightRetriever(),
): Record<string, Tool> {
  if (!retriever) return {};

  return {
    search_insights: tool({
      description:
        "Search the workspace knowledge base for industry insights, case studies and prior research notes. "
        + "Use alongside live SEO/GEO data tools when the question needs background, not instead of rankings or AI visibility lookups. "
        + "Returns up to five bounded public passages with source URLs and retrieval dates.",
      inputSchema: z.object({
        query: z.string().trim().min(1).max(QUERY_MAX),
      }),
      execute: async ({ query }) => {
        try {
          const passages = normalizeInsightPassages(
            await retriever.search({
              workspaceId: ctx.workspaceId,
              query,
              limit: 5,
              signal: ctx.signal,
            }),
          );
          if (passages.length === 0) {
            return forModelData("live", { passages: [], total: 0 }, "search_insights");
          }
          addCard(ctx, {
            tool: "search_insights",
            title: "Knowledge insights",
            cached: false,
            data: passages,
            sandbox: false,
          });
          return forModelData("live", { passages, total: passages.length }, "search_insights");
        } catch {
          addNotice(ctx, "Knowledge insights could not be loaded for this question.");
          return { error: "failed" };
        }
      },
    }),
  };
}
