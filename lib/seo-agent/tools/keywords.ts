import { tool } from "ai";
import { z } from "zod";

import {
  type CompetitorDomain,
  type KeywordRow,
  type RankedKeyword,
  fetchCompetitorDomains,
  fetchKeywordGap,
  fetchKeywordIdeas,
  fetchKeywordOverview,
  fetchRankedKeywords,
  peekCompetitorDomains,
  peekKeywordGap,
  peekKeywordIdeas,
  peekKeywordOverview,
  peekRankedKeywords,
} from "@/lib/dataforseo/labs";
import { normalizeTarget } from "@/lib/dataforseo/backlinks";
import {
  type ToolContext,
  domainField,
  gateOptions,
  keywordLabel,
  keywordsField,
  normalizeKeywords,
  runGated,
} from "@/lib/seo-agent/tools/shared";

export function keywordTools(ctx: ToolContext) {
  return {
    keyword_ideas: tool({
      description: "Keyword ideas related to seed keywords, with search volume, difficulty and intent.",
      inputSchema: z.object({ keywords: keywordsField }).strict(),
      strict: true,
      execute: async ({ keywords }) => {
        const list = normalizeKeywords(keywords);
        if (!list) return { error: "invalid_keywords" };
        return runGated(ctx, {
          tool: "keyword_ideas",
          title: `Keyword ideas — ${keywordLabel(list)}`,
          input: { keywords: list },
          credits: 1,
          peek: () => peekKeywordIdeas(list),
          fetch: () => fetchKeywordIdeas(ctx.workspaceId, list, undefined, gateOptions(ctx)),
        });
      },
    }),

    keyword_overview: tool({
      description: "Search volume, difficulty and search intent for specific keywords.",
      inputSchema: z.object({ keywords: keywordsField }).strict(),
      strict: true,
      execute: async ({ keywords }) => {
        const list = normalizeKeywords(keywords);
        if (!list) return { error: "invalid_keywords" };
        return runGated<KeywordRow[]>(ctx, {
          tool: "keyword_overview",
          title: `Keyword overview — ${keywordLabel(list)}`,
          input: { keywords: list },
          credits: 1,
          peek: () => peekKeywordOverview(list),
          fetch: () => fetchKeywordOverview(ctx.workspaceId, list, gateOptions(ctx)),
        });
      },
    }),

    ranked_keywords: tool({
      description: "Keywords a domain already ranks for in Google organic results, with position and ranking URL.",
      inputSchema: z.object({ domain: domainField }).strict(),
      strict: true,
      execute: async ({ domain }) => {
        const target = normalizeTarget(domain);
        if (!target) return { error: "invalid_domain" };
        return runGated<RankedKeyword[]>(ctx, {
          tool: "ranked_keywords",
          title: `Ranked keywords — ${target}`,
          input: { domain: target },
          credits: 1,
          peek: () => peekRankedKeywords(target),
          fetch: () => fetchRankedKeywords(ctx.workspaceId, target, undefined, gateOptions(ctx)),
        });
      },
    }),

    competitor_domains: tool({
      description: "Domains that compete with a domain for the same Google keywords.",
      inputSchema: z.object({ domain: domainField }).strict(),
      strict: true,
      execute: async ({ domain }) => {
        const target = normalizeTarget(domain);
        if (!target) return { error: "invalid_domain" };
        return runGated<CompetitorDomain[]>(ctx, {
          tool: "competitor_domains",
          title: `Competitors — ${target}`,
          input: { domain: target },
          credits: 1,
          peek: () => peekCompetitorDomains(target),
          fetch: () => fetchCompetitorDomains(ctx.workspaceId, target, undefined, gateOptions(ctx)),
        });
      },
    }),

    keyword_gap: tool({
      description: "Keywords a competitor ranks for that the domain does not.",
      inputSchema: z.object({ domain: domainField, competitor: domainField }).strict(),
      strict: true,
      execute: async ({ domain, competitor }) => {
        const own = normalizeTarget(domain);
        const rival = normalizeTarget(competitor);
        if (!own || !rival) return { error: "invalid_domain" };
        return runGated<RankedKeyword[]>(ctx, {
          tool: "keyword_gap",
          title: `Keyword gap — ${rival} vs ${own}`,
          input: { domain: own, competitor: rival },
          credits: 1,
          peek: () => peekKeywordGap(own, rival),
          fetch: () => fetchKeywordGap(ctx.workspaceId, own, rival, undefined, gateOptions(ctx)),
        });
      },
    }),
  };
}
