import { getOpportunityDetail, listOpportunityQueue } from "@/lib/opportunities/run";
import { redditThreadBlocks } from "@/lib/workspace/blocks";

/** Existing workspace evidence only; discovery tools are a separate, explicitly metered stage. */
export async function loadGtmEvidence(workspaceId: string) {
  const queue = await listOpportunityQueue({ workspaceId, limit: 5 });
  const details = await Promise.all(queue.slice(0, 5).map(item => getOpportunityDetail({ workspaceId, opportunityId: item.id })));
  const evidence = details.filter(detail => detail !== null);
  return {
    tool: "gtm_evidence", title: "Current workspace evidence", fetchedAt: new Date().toISOString(), cached: false,
    data: {
      evidence: evidence.map(detail => ({ id: detail.id, title: detail.title.slice(0, 300), summary: detail.summary.slice(0, 600), whyItMatters: detail.whyItMatters.slice(0, 500),
        sources: detail.evidence.slice(0, 2).map(source => ({ title: source.title?.slice(0, 300) ?? null, url: source.urlCanonical, platform: source.platform, excerpt: source.contentMd.slice(0, 800) })) })),
      blocks: redditThreadBlocks(evidence).slice(0, 3),
    },
  };
}
