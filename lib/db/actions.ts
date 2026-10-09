"use server";

import { auth } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { workspace } from "@/lib/db/schema";

/**
 * Creates a workspace row for the signed-in Neon Auth user.
 * Requires DATABASE_URL + Neon Auth env vars.
 */
export async function createWorkspaceForCurrentUser(name: string) {
  const { data: session } = await auth.getSession();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const db = getDb();
  const [row] = await db
    .insert(workspace)
    .values({
      name,
      ownerUserId: session.user.id as string,
      plan: "free",
    })
    .returning();

  return row;
}

