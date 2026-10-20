"use server";

import { redirect } from "next/navigation";

import { auth } from "@/lib/auth/server";
import { setCurrentWorkspace } from "@/lib/auth/workspace";
import { createWorkspaceForCurrentUser } from "@/lib/db/actions";
import { PlanLimitError } from "@/lib/plans/types";

export async function startWorkspace(_state: { error: string }, form: FormData): Promise<{ error: string }> {
  const { data: session } = await auth.getSession();
  if (!session?.user?.id) {
    return { error: "Your session has expired. Sign in again to continue." };
  }

  const name = String(form.get("name") ?? "").trim();
  if (!name || name.length > 100) {
    return { error: "Workspace name must contain 1–100 characters." };
  }

  let workspace;
  try {
    workspace = await createWorkspaceForCurrentUser(name, form.get("additional") === "true");
    if (!workspace) return { error: "We couldn’t create your workspace. Please try again." };
  } catch (error) {
    if (error instanceof PlanLimitError) return { error: "You’ve reached the workspace limit for your plan. Open an existing workspace or review your plan." };
    return { error: "We couldn’t create your workspace. Please try again." };
  }

  if (!(await setCurrentWorkspace(workspace.id))) {
    return { error: "Your session has expired. Sign in again to continue." };
  }
  redirect("/setup");
}
