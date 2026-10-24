/**
 * Optional backfill of topic_volume_daily from stored documents (issue #99).
 * Run by a human against a chosen branch: `DATABASE_URL=... pnpm tsx scripts/backfill-topic-volume.ts`.
 * Rebuilds the 28-day window per workspace: existing counts in the window are
 * replaced with a fresh count over every stored document. Never part of deploy.
 * Arctic Shift is deliberately not used as a live source; this reads stored rows only.
 */
import { desc, eq } from "drizzle-orm";

import { getDb } from "../lib/db/client";
import { monitoringProfile, workspace } from "../lib/db/schema";
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
