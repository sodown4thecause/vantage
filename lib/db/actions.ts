"use server";

import { auth } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { document, lead, workspace } from "@/lib/db/schema";

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

/** Smoke-test insert path used by verification scripts. */
export async function insertDocumentAndLead(input: {
  workspaceId: string;
  urlCanonical: string;
  platform: string;
  contentMd: string;
  contentHash: string;
  reason?: string;
}) {
  const db = getDb();
  const [doc] = await db
    .insert(document)
    .values({
      workspaceId: input.workspaceId,
      urlCanonical: input.urlCanonical,
      platform: input.platform,
      contentMd: input.contentMd,
      contentHash: input.contentHash,
    })
    .returning();

  const [row] = await db
    .insert(lead)
    .values({
      workspaceId: input.workspaceId,
      documentId: doc.id,
      reason: input.reason ?? "scaffold verification",
      status: "new",
    })
    .returning();

  return { document: doc, lead: row };
}
