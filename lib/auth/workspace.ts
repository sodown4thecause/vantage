import { and, eq } from "drizzle-orm";

import { auth } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { workspace } from "@/lib/db/schema";

export type WorkspaceAuthorization =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403; error: "unauthorized" | "forbidden" };

/** The same decision for an agent credential, which has no user id. */
export type AgentWorkspaceAuthorization =
  | { ok: true; via: "agent" }
  | { ok: false; status: 401 | 403; error: "unauthorized" | "forbidden" };

/**
 * A credential an agent already proved with `authenticateMcpRequest`. Passing it
 * lets `authorizeWorkspace` stay the single place that decides workspace access
 * without pretending an agent has a Neon Auth session.
 */
export type AgentGrant = {
  registrationId: string;
  workspaceId: string | null;
};

export async function getCurrentWorkspace(): Promise<{ id: string; name: string } | null> {
  const { data: session } = await auth.getSession();
  if (!session?.user?.id) return null;
  const [owned] = await getDb().select({ id: workspace.id, name: workspace.name })
    .from(workspace).where(eq(workspace.ownerUserId, String(session.user.id))).limit(1);
  return owned ?? null;
}

/** Require an authenticated Neon Auth user who owns the requested workspace. */
export async function authorizeWorkspace(workspaceId: string): Promise<WorkspaceAuthorization>;
/**
 * The same check for an agent: its verified registration must still be active
 * and bound to the workspace being written. A token can outlive either.
 */
export async function authorizeWorkspace(
  workspaceId: string,
  agent: AgentGrant,
): Promise<AgentWorkspaceAuthorization>;
export async function authorizeWorkspace(
  workspaceId: string,
  agent?: AgentGrant,
): Promise<WorkspaceAuthorization | AgentWorkspaceAuthorization> {
  if (agent) {
    if (agent.workspaceId !== workspaceId) {
      return { ok: false, status: 403, error: "forbidden" };
    }
    // Imported lazily: most callers authorize a session and should not pull the
    // agent registration code into their bundle.
    const { drizzleRegistrationStore } = await import("@/lib/agent/registration");
    const registration = await drizzleRegistrationStore().findRegistration(agent.registrationId);
    if (
      !registration ||
      registration.status !== "active" ||
      registration.workspaceId !== workspaceId ||
      registration.expiresAt.getTime() <= Date.now()
    ) {
      return { ok: false, status: 403, error: "forbidden" };
    }
    return { ok: true, via: "agent" };
  }

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
