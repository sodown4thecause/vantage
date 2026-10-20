import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { workspace } from "@/lib/db/schema";

export type WorkspaceAuthorization =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403; error: "unauthorized" | "forbidden" };

export const WORKSPACE_COOKIE = "vantage-workspace";

export async function listOwnedWorkspaces(): Promise<Array<{ id: string; name: string }>> {
  const { data: session } = await auth.getSession();
  if (!session?.user?.id) return [];
  return getDb().select({ id: workspace.id, name: workspace.name })
    .from(workspace).where(eq(workspace.ownerUserId, String(session.user.id)));
}

export async function getCurrentWorkspace(): Promise<{ id: string; name: string } | null> {
  const owned = await listOwnedWorkspaces();
  if (!owned.length) return null;
  const selected = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  return owned.find((row) => row.id === selected) ?? owned[0];
}

export async function setCurrentWorkspace(workspaceId: string): Promise<boolean> {
  if (!z.uuid().safeParse(workspaceId).success) return false;
  const authorization = await authorizeWorkspace(workspaceId);
  if (!authorization.ok) return false;
  (await cookies()).set(WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return true;
}

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
