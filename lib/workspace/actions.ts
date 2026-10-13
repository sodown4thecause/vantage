"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { authorizeWorkspace } from "@/lib/auth/workspace";
import { withWorkspaceScanLease } from "@/lib/cron/lease";
import { ScanLeaseBusyError } from "@/lib/cron/lease-error";
import { getDb } from "@/lib/db/client";
import { workspace } from "@/lib/db/schema";
import { deleteWorkspaceData } from "@/lib/workspace/delete";

export type DeleteWorkspaceState = { error?: string };

const REFUSED = "Unable to delete this workspace.";

async function removeWorkspace(workspaceId: string, form: FormData): Promise<DeleteWorkspaceState> {
  try {
    const authorization = await authorizeWorkspace(workspaceId);
    if (!authorization.ok) return { error: REFUSED };

    const [row] = await getDb()
      .select({ name: workspace.name })
      .from(workspace)
      .where(and(eq(workspace.id, workspaceId), eq(workspace.ownerUserId, authorization.userId)))
      .limit(1);
    if (!row) return { error: REFUSED };
    if (String(form.get("confirm") ?? "").trim() !== row.name) {
      return { error: "Type the workspace name exactly to confirm." };
    }

    const deleted = await withWorkspaceScanLease(workspaceId, () =>
      deleteWorkspaceData(workspaceId, authorization.userId),
    );
    return deleted ? {} : { error: REFUSED };
  } catch (error) {
    if (error instanceof ScanLeaseBusyError) {
      return { error: "A scan is running for this workspace. Try again in a minute." };
    }
    // Only the error class is logged: exception text can embed database details.
    console.error("[workspace/delete] failed", { error: error instanceof Error ? error.name : "unknown" });
    return { error: "Workspace could not be deleted. Please try again." };
  }
}

/** Deletes the workspace and its data after the owner types its name. Redirects to onboarding on success. */
export async function deleteWorkspace(
  workspaceId: string,
  _previous: DeleteWorkspaceState,
  form: FormData,
): Promise<DeleteWorkspaceState> {
  // redirect() throws to end the request, so it stays outside removeWorkspace's try/catch.
  const result = await removeWorkspace(workspaceId, form);
  if (result.error) return result;
  revalidatePath("/");
  redirect("/onboarding");
}
