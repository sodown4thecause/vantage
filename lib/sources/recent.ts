import { and, desc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { document, source } from "@/lib/db/schema";

export type RecentPost = {
  id: string;
  title: string;
  url: string;
  platform: string;
  sourceName: string | null;
  postedAt: Date | null;
  collectedAt: Date | null;
  /** True for fixture/sample data, so the UI never passes it off as a live post. */
  sample: boolean;
};

/** The newest posts collected for one workspace, across all of its sources. */
export async function listRecentPosts(workspaceId: string, limit = 10): Promise<RecentPost[]> {
  const rows = await getDb()
    .select({
      id: document.id,
      title: document.title,
      url: document.urlCanonical,
      platform: document.platform,
      postedAt: document.postedAt,
      collectedAt: document.collectedAt,
      metadata: document.metadata,
      sourceName: source.name,
    })
    .from(document)
    // Both sides are pinned to the workspace so a mismatched source id can never leak another workspace's name.
    .leftJoin(source, and(eq(source.id, document.sourceId), eq(source.workspaceId, workspaceId)))
    .where(eq(document.workspaceId, workspaceId))
    .orderBy(desc(document.collectedAt))
    .limit(Math.min(Math.max(1, Math.floor(limit)), 50));
  return rows.map((row) => {
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      title: row.title?.trim() || row.url,
      url: row.url,
      platform: row.platform,
      sourceName: row.sourceName ?? null,
      postedAt: row.postedAt,
      collectedAt: row.collectedAt,
      sample: metadata.mocked === true || metadata.provider === "fixture",
    };
  });
}
