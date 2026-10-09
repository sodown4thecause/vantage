import { desc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { source } from "@/lib/db/schema";

/** Sources for a workspace, newest first. */
export async function listSourcesForWorkspace(workspaceId: string) {
  const db = getDb();
  return db
    .select({
      id: source.id,
      name: source.name,
      type: source.type,
      lane: source.lane,
      health: source.health,
      lastPolledAt: source.lastPolledAt,
      createdAt: source.createdAt,
    })
    .from(source)
    .where(eq(source.workspaceId, workspaceId))
    .orderBy(desc(source.createdAt))
    .limit(100);
}
