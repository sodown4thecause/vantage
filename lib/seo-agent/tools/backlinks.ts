import { tool } from "ai";
import { z } from "zod";

import {
  type Anchor,
  type BacklinkCall,
  type BacklinkSummary,
  type ReferringDomain,
  anchorsTask,
  fetchAnchors,
  fetchBacklinkSummary,
  fetchReferringDomains,
  normalizeTarget,
  referringDomainGap,
  referringDomainsTask,
  summaryTask,
} from "@/lib/dataforseo/backlinks";
import { FRESHNESS_SECONDS } from "@/lib/dataforseo/cache";
import { peekDataForSeo } from "@/lib/dataforseo/gate";
import {
  type ToolContext,
  addCard,
  domainField,
  failureCode,
  forModelData,
  gateOptions,
  runGated,
  settleAll,
} from "@/lib/seo-agent/tools/shared";

const peekBacklink = <T>(call: BacklinkCall) => peekDataForSeo<T>(call.endpoint, call.task, FRESHNESS_SECONDS.backlinks);

/**
 * Referring domains of a competitor that do not link to us. Each side is one referring-domains call; a cached side
 * costs nothing, so the reservation is one credit per uncached side.
 */
async function backlinkGap(ctx: ToolContext, own: string, rival: string): Promise<unknown> {
  const input = { domain: own, competitor: rival };
  const title = `Backlink gap — ${rival} vs ${own}`;

  let ownHit: ReferringDomain[] | null;
  let rivalHit: ReferringDomain[] | null;
  try {
    [ownHit, rivalHit] = await Promise.all([
      peekBacklink<ReferringDomain[]>(referringDomainsTask(own)),
      peekBacklink<ReferringDomain[]>(referringDomainsTask(rival)),
    ]);
  } catch {
    return { error: "failed" };
  }

  if (ownHit !== null && rivalHit !== null) {
    const gap = referringDomainGap(ownHit, rivalHit, own);
    addCard(ctx, { tool: "backlink_gap", title, cached: true, data: gap });
    return forModelData("cached", gap, "backlink_gap");
  }

  const sides = [
    { target: own, reserved: ownHit === null ? 1 : 0 },
    { target: rival, reserved: rivalHit === null ? 1 : 0 },
  ];
  const credits = sides.reduce((sum, side) => sum + side.reserved, 0);
  if (ctx.budget.tryReserve({ tool: "backlink_gap", input, credits }, false) === "ask") {
    return { status: "needs_approval", credits };
  }

  const results = await settleAll(sides, (side) => fetchReferringDomains(ctx.workspaceId, side.target, gateOptions(ctx)));
  let refund = 0;
  let failed: string | null = null;
  let fresh = false;
  for (const result of results) {
    if (!result.ok) {
      refund += result.item.reserved;
      if (failed === null) failed = failureCode(ctx, result.error);
      continue;
    }
    if (result.value.cached) refund += result.item.reserved;
    else fresh = true;
  }
  ctx.budget.refund(refund);
  if (failed !== null) return { error: failed };

  const [ownRows, rivalRows] = results.map((result) => (result.ok ? result.value.value : []));
  const gap = referringDomainGap(ownRows, rivalRows, own);
  addCard(ctx, { tool: "backlink_gap", title, cached: !fresh, data: gap });
  return forModelData(fresh ? "live" : "cached", gap, "backlink_gap");
}

export function backlinkTools(ctx: ToolContext) {
  return {
    backlink_summary: tool({
      description: "Backlink totals, referring domains, broken links and spam score for one domain.",
      inputSchema: z.object({ domain: domainField }).strict(),
      strict: true,
      execute: async ({ domain }) => {
        const target = normalizeTarget(domain);
        if (!target) return { error: "invalid_domain" };
        return runGated(ctx, {
          tool: "backlink_summary",
          title: `Backlink summary — ${target}`,
          input: { domain: target },
          credits: 1,
          peek: () => peekBacklink<BacklinkSummary>(summaryTask(target)),
          fetch: () => fetchBacklinkSummary(ctx.workspaceId, target, gateOptions(ctx)),
        });
      },
    }),

    referring_domains: tool({
      description: "The top referring domains that link to one domain, ranked by authority.",
      inputSchema: z.object({ domain: domainField }).strict(),
      strict: true,
      execute: async ({ domain }) => {
        const target = normalizeTarget(domain);
        if (!target) return { error: "invalid_domain" };
        return runGated(ctx, {
          tool: "referring_domains",
          title: `Referring domains — ${target}`,
          input: { domain: target },
          credits: 1,
          peek: () => peekBacklink<ReferringDomain[]>(referringDomainsTask(target)),
          fetch: () => fetchReferringDomains(ctx.workspaceId, target, gateOptions(ctx)),
        });
      },
    }),

    backlink_gap: tool({
      description: "Referring domains that link to a competitor but not to the domain. Costs one credit per side not already cached.",
      inputSchema: z.object({ domain: domainField, competitor: domainField }).strict(),
      strict: true,
      execute: async ({ domain, competitor }) => {
        const own = normalizeTarget(domain);
        const rival = normalizeTarget(competitor);
        if (!own || !rival) return { error: "invalid_domain" };
        return backlinkGap(ctx, own, rival);
      },
    }),

    anchors: tool({
      description: "The most common anchor texts pointing at one domain.",
      inputSchema: z.object({ domain: domainField }).strict(),
      strict: true,
      execute: async ({ domain }) => {
        const target = normalizeTarget(domain);
        if (!target) return { error: "invalid_domain" };
        return runGated(ctx, {
          tool: "anchors",
          title: `Anchor texts — ${target}`,
          input: { domain: target },
          credits: 1,
          peek: () => peekBacklink<Anchor[]>(anchorsTask(target)),
          fetch: () => fetchAnchors(ctx.workspaceId, target, gateOptions(ctx)),
        });
      },
    }),
  };
}
