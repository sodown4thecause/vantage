import { tool } from "ai";
import { z } from "zod";

import { fetchGoogleSerp, peekGoogleSerp } from "@/lib/dataforseo/serp";
import { type ToolContext, MAX_KEYWORD_CHARS, gateOptions, runGated } from "@/lib/seo-agent/tools/shared";

export function serpTools(ctx: ToolContext) {
  return {
    google_serp: tool({
      description: "Live Google organic results for one keyword: top 10 domains and URLs, AI overview presence and related questions.",
      inputSchema: z.object({ keyword: z.string().trim().min(1).max(MAX_KEYWORD_CHARS) }).strict(),
      strict: true,
      execute: async ({ keyword }) => {
        const query = keyword.trim();
        if (!query || query.length > MAX_KEYWORD_CHARS) return { error: "invalid_keyword" };
        return runGated(ctx, {
          tool: "google_serp",
          title: `Google results — ${query}`,
          input: { keyword: query },
          credits: 1,
          peek: () => peekGoogleSerp(query),
          fetch: () => fetchGoogleSerp(ctx.workspaceId, query, gateOptions(ctx)),
        });
      },
    }),
  };
}
