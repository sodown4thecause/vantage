import { and, desc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { savedArtifact } from "@/lib/db/schema";
import { parseBlocks, type Block } from "@/lib/workspace/blocks";
import type { SavedArtifactLane } from "@/lib/workspace/saved-artifact-types";

/*
 * Saved answers and visual blocks. Every query is scoped by workspaceId; callers run authorizeWorkspace first,
 * the same as conversations. Blocks are validated by the route before insert and re-parsed on read.
 */

export type SavedArtifactView = {
  id: string;
  lane: SavedArtifactLane;
  title: string;
  blocks: Block[];
  createdAt: string;
};

type Row = typeof savedArtifact.$inferSelect;

const toView = (row: Pick<Row, "id" | "lane" | "title" | "blocks" | "createdAt">): SavedArtifactView => ({
  id: row.id,
  lane: row.lane,
  title: row.title,
  blocks: parseBlocks(row.blocks),
  createdAt: row.createdAt.toISOString(),
});

export async function createSavedArtifact(workspaceId: string, input: {
  lane: SavedArtifactLane;
  title: string;
  blocks: Block[];
  createdBy: string;
}): Promise<SavedArtifactView> {
  const [row] = await getDb()
    .insert(savedArtifact)
    .values({ workspaceId, lane: input.lane, title: input.title, blocks: input.blocks, createdBy: input.createdBy })
    .returning();
  return toView(row!);
}

/** Newest first. */
export async function listSavedArtifacts(workspaceId: string, limit = 50): Promise<SavedArtifactView[]> {
  const rows = await getDb()
    .select()
    .from(savedArtifact)
    .where(eq(savedArtifact.workspaceId, workspaceId))
    .orderBy(desc(savedArtifact.createdAt))
    .limit(limit);
  return rows.map(toView);
}

/** Deletes only when the artifact belongs to the workspace. Returns whether a row was deleted. */
export async function deleteSavedArtifact(workspaceId: string, id: string): Promise<boolean> {
  const rows = await getDb()
    .delete(savedArtifact)
    .where(and(eq(savedArtifact.id, id), eq(savedArtifact.workspaceId, workspaceId)))
    .returning({ id: savedArtifact.id });
  return rows.length > 0;
}
