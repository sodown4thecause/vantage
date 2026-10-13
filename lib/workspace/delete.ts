import { and, asc, eq, gt } from "drizzle-orm";

import { MAX_MATERIAL_CHUNKS, materialVectorId } from "@/lib/drafting/ground";
import { getDb } from "@/lib/db/client";
import { document, monitoringProfile, workspace } from "@/lib/db/schema";
import { MAX_PROFILE_VECTORS, profileVectorId } from "@/lib/embeddings/index-profile";
import { deleteVectors } from "@/lib/embeddings/store";

/** Document ids read per page, so a large workspace never holds all of its ids in memory. */
const DOCUMENT_PAGE = 1000;

/** Every vector id one monitoring profile version can own: profile chunks, then material chunks. */
function profileOwnedVectorIds(profileId: string): string[] {
  return [
    ...Array.from({ length: MAX_PROFILE_VECTORS }, (_, n) => profileVectorId(profileId, n)),
    ...Array.from({ length: MAX_MATERIAL_CHUNKS }, (_, n) => materialVectorId(profileId, n)),
  ];
}

/** Only the error class is logged: exception text can embed database or endpoint details. */
function logCleanupIncomplete(stage: string, err?: unknown): void {
  console.error("[workspace/delete] vector cleanup incomplete", {
    stage,
    error: err instanceof Error ? err.name : undefined,
  });
}

/**
 * Removes the workspace's vectors from Vectorize. Ids come from rows the workspace
 * owns, and both reads are scoped by workspaceId. Stops at the first failed batch:
 * the leftovers are unreachable once the workspace row is gone. Never throws.
 */
async function removeWorkspaceVectors(workspaceId: string): Promise<void> {
  try {
    const db = getDb();
    const profiles = await db
      .select({ id: monitoringProfile.id })
      .from(monitoringProfile)
      .where(eq(monitoringProfile.workspaceId, workspaceId));
    const profileIds = profiles.flatMap(({ id }) => profileOwnedVectorIds(id));
    if (!(await deleteVectors(workspaceId, profileIds))) {
      logCleanupIncomplete("profile");
      return;
    }

    // Keyset pages over document ids. Document rows are still present here: the row delete cascades them away.
    let after: string | undefined;
    for (;;) {
      const page = await db
        .select({ id: document.id })
        .from(document)
        .where(and(eq(document.workspaceId, workspaceId), after ? gt(document.id, after) : undefined))
        .orderBy(asc(document.id))
        .limit(DOCUMENT_PAGE);
      if (page.length === 0) return;
      if (!(await deleteVectors(workspaceId, page.map(({ id }) => `doc:${id}`)))) {
        logCleanupIncomplete("document");
        return;
      }
      const last = page[page.length - 1];
      if (!last || page.length < DOCUMENT_PAGE) return;
      after = last.id;
    }
  } catch (err) {
    logCleanupIncomplete("read", err);
  }
}

/**
 * Permanently deletes a workspace and every row it owns (the database cascades
 * from the workspace row). The delete matches both the workspace id and the owner,
 * so it can only remove a workspace its owner controls.
 *
 * Vectorize vectors go first, while the document and profile rows that name them
 * still exist. That cleanup is best-effort: a failure is logged and never blocks the row delete.
 *
 * Screenshot objects in R2 are not removed. The bucket type in lib/r2/artifacts.ts exposes only
 * `put`, so there is no way to list or delete `${workspaceId}/` keys. No table stores their keys.
 *
 * Returns true only when this call deleted the row.
 */
export async function deleteWorkspaceData(workspaceId: string, ownerUserId: string): Promise<boolean> {
  await removeWorkspaceVectors(workspaceId);
  const rows = await getDb()
    .delete(workspace)
    .where(and(eq(workspace.id, workspaceId), eq(workspace.ownerUserId, ownerUserId)))
    .returning({ id: workspace.id });
  return rows.length > 0;
}
