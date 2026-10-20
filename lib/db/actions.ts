"use server";

import { sql } from "drizzle-orm";

import { auth } from "@/lib/auth/server";
import { authorizeWorkspace, getCurrentWorkspace } from "@/lib/auth/workspace";
import { getDb } from "@/lib/db/client";
import { rowsOf } from "@/lib/db/rows";
import { document, lead, workspace } from "@/lib/db/schema";
import { assertCanCreateProject } from "@/lib/plans/limits";
import { PlanLimitError } from "@/lib/plans/types";
import type { SourcePlatform } from "@/lib/db/schema";

/**
 * Creates a workspace row for the signed-in Neon Auth user.
 * Requires DATABASE_URL + Neon Auth env vars.
 */
export async function createWorkspaceForCurrentUser(name: string, additional = false) {
  name = name.trim();
  if (!name || name.length > 100) throw new Error("Workspace name must contain 1–100 characters.");
  const { data: session } = await auth.getSession();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  if (!additional) {
    const existing = await getCurrentWorkspace();
    if (existing) return existing;
  }
  const ownerUserId = String(session.user.id);
  let limit: number;
  try {
    limit = await assertCanCreateProject(ownerUserId);
  } catch (error) {
    if (!additional) {
      const existing = await getCurrentWorkspace();
      if (existing) return existing;
    }
    throw error;
  }
  const db = getDb();
  const [, result] = await db.batch([
    db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${ownerUserId}, 0))`),
    db.execute(sql`with owned as (
      select count(*) as n from ${workspace} where ${workspace.ownerUserId} = ${ownerUserId}
    )
    insert into ${workspace} ("name", "owner_user_id", "plan")
    select ${name}, ${ownerUserId}, 'free' from owned
    where owned.n < ${limit} and (${additional} or owned.n = 0)
    returning "id", "name"`),
  ]);
  const row = rowsOf(result)[0] as { id: string; name: string } | undefined;
  if (row) return row;
  if (!additional) {
    const existing = await getCurrentWorkspace();
    if (existing) return existing;
  }
  throw new PlanLimitError("projects", limit, "Workspace limit reached for this plan.");
}

/** Smoke-test insert path used by verification scripts. */
export async function insertDocumentAndLead(input: {
  workspaceId: string;
  urlCanonical: string;
  platform: SourcePlatform;
  contentMd: string;
  contentHash: string;
  reason?: string;
}) {
  const authorization = await authorizeWorkspace(input.workspaceId);
  if (!authorization.ok) throw new Error(authorization.error);
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
