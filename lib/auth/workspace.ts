import { and, eq } from "drizzle-orm";

import { auth } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { workspace } from "@/lib/db/schema";

export type WorkspaceAuthorization =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403; error: "unauthorized" | "forbidden" };

/** Require an authenticated Neon Auth user who owns the requested workspace. */
export async function authorizeWorkspace(
  workspaceId: string,
): Promise<WorkspaceAuthorization> {
  const { data: session } = await auth.getSession();
  const userId = session?.user?.id;
  if (!userId) {
    return { ok: false, status: 401, error: "unauthorized" };
  }

  const db = getDb();
  const [ownedWorkspace] = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(
      and(
        eq(workspace.id, workspaceId),
        eq(workspace.ownerUserId, String(userId)),
      ),
    )
    .limit(1);

  if (!ownedWorkspace) {
    return { ok: false, status: 403, error: "forbidden" };
  }
  return { ok: true, userId: String(userId) };
}
