import { and, eq, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { document, lead } from "@/lib/db/schema";
import { runPipeline, listReviewQueue } from "@/lib/pipeline/run";
import { scoreOpportunity, type ScoredOpportunity } from "./features";

export type RunOpportunitiesInput = {
  workspaceId: string;
  limit?: number;
  threshold?: number;
};

export type RunOpportunitiesOutput = {
  pipeline: Awaited<ReturnType<typeof runPipeline>>;
  scored: ScoredOpportunity[];
};

export async function runOpportunities(
  input: RunOpportunitiesInput,
): Promise<RunOpportunitiesOutput> {
  const pipeline = await runPipeline({
    workspaceId: input.workspaceId,
    limit: input.limit,
    threshold: input.threshold,
  });

  const db = getDb();
  const queue = await listReviewQueue(input.workspaceId);

  const scored: ScoredOpportunity[] = [];
  for (const { lead: l, document: d } of queue) {
    const scoredEntry = await scoreOpportunity(l, d, input.workspaceId);
    scored.push(scoredEntry);
  }

  return { pipeline, scored };
}

export async function listOpportunities(
  workspaceId: string,
  limit = 50,
): Promise<ScoredOpportunity[]> {
  const db = getDb();
  const rows = await db
    .select({
      lead,
      document,
    })
    .from(lead)
    .innerJoin(document, eq(document.id, lead.documentId))
    .where(
      and(
        eq(lead.workspaceId, workspaceId),
        inArray(lead.status, ["new", "queued", "reviewing"]),
      ),
    )
    .orderBy(lead.score, lead.createdAt)
    .limit(limit);

  const scored: ScoredOpportunity[] = [];
  for (const { lead: l, document: d } of rows) {
    const entry = await scoreOpportunity(l, d, workspaceId);
    scored.push(entry);
  }

  return scored;
}
