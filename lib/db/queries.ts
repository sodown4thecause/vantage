import { desc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { workspace } from "@/lib/db/schema";

/** Workspaces owned by a user, newest first. */
export async function listWorkspacesForUser(userId: string) {
  const db = getDb();
  return db
    .select({
      id: workspace.id,
      name: workspace.name,
      plan: workspace.plan,
      createdAt: workspace.createdAt,
    })
    .from(workspace)
    .where(eq(workspace.ownerUserId, userId))
    .orderBy(desc(workspace.createdAt))
    .limit(50);
}
