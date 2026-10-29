/**
 * Optional backfill of topic_volume_daily from stored documents (issue #99).
 * Run by a human against a chosen branch, one workspace at a time:
 * `DATABASE_URL=... pnpm tsx scripts/backfill-topic-volume.ts <workspaceId>`.
 * Rebuilds the 28-day window for that workspace: existing counts in the window
 * are replaced with a fresh count over every stored document. Never part of deploy.
 * Arctic Shift is deliberately not used as a live source; this reads stored rows only.
 */
import { desc, eq } from "drizzle-orm";

import { getDb } from "../lib/db/client";
import { monitoringProfile, workspace } from "../lib/db/schema";
import { parseBackfillArgs } from "../lib/trends/backfill-args";
import { recordWorkspaceTopicVolume } from "../lib/trends/volume";

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

  return recordWorkspaceTopicVolume(workspaceId, topics, { rebuild: true });
}

async function main() {
  const { workspaceId } = parseBackfillArgs(process.argv.slice(2));
  const [found] = await getDb()
    .select({ id: workspace.id })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  if (!found) throw new Error(`workspace ${workspaceId} not found`);
  const rows = await backfillWorkspace(found.id);
  console.log(`workspace ${found.id}: ${rows} topic/day rows`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
