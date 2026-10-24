/**
 * Optional backfill of topic_volume_daily from stored documents (issue #99).
 * Run by a human against a chosen branch: `DATABASE_URL=... pnpm tsx scripts/backfill-topic-volume.ts`.
 * Rebuilds the 28-day window per workspace: existing counts in the window are
 * replaced with a fresh count over every stored document. Never part of deploy.
 * Arctic Shift is deliberately not used as a live source; this reads stored rows only.
 */
import { and, desc, eq, gte, sql } from "drizzle-orm";

import { getDb } from "../lib/db/client";
import { document, monitoringProfile, topicVolumeDaily, workspace } from "../lib/db/schema";
import { countTopicMentions } from "../lib/trends/volume";

const WINDOW_DAYS = 28;
const DOC_LIMIT = 2_000;

async function backfillWorkspace(workspaceId: string): Promise<number> {
  const db = getDb();
  const [profile] = await db
    .select()
    .from(monitoringProfile)
    .where(eq(monitoringProfile.workspaceId, workspaceId))
    .orderBy(desc(monitoringProfile.version))
    .limit(1);
  const topics = profile?.topics ?? [];
  if (topics.length === 0) return 0;

  const since = new Date(Date.now() - (WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000).toISOString();
  const docs = await db
    .select({
      id: document.id,
      platform: document.platform,
      postedAt: document.postedAt,
      collectedAt: document.collectedAt,
      title: document.title,
      contentMd: document.contentMd,
    })
    .from(document)
    .where(and(
      eq(document.workspaceId, workspaceId),
      sql`coalesce(${document.postedAt}, ${document.collectedAt}) >= ${since}::timestamptz`,
    ))
    .orderBy(desc(document.collectedAt))
    .limit(DOC_LIMIT);

  const rows = countTopicMentions(docs, topics);
  await db
    .delete(topicVolumeDaily)
    .where(and(
      eq(topicVolumeDaily.workspaceId, workspaceId),
      gte(topicVolumeDaily.day, since.slice(0, 10)),
    ));
  for (let i = 0; i < rows.length; i += 500) {
    await db.insert(topicVolumeDaily)
      .values(rows.slice(i, i + 500).map((row) => ({ ...row, workspaceId })))
      .onConflictDoNothing();
  }
  return rows.length;
}

async function main() {
  const db = getDb();
  const workspaces = await db.select({ id: workspace.id }).from(workspace);
  let total = 0;
  for (const { id } of workspaces) {
    const rows = await backfillWorkspace(id);
    total += rows;
    console.log(`workspace ${id}: ${rows} topic/day rows`);
  }
  console.log(`backfill complete: ${total} rows across ${workspaces.length} workspace(s)`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
