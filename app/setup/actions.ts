"use server";

import { redirect } from "next/navigation";

import { auth } from "@/lib/auth/server";
import { createWorkspaceForCurrentUser } from "@/lib/db/actions";

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
    workspace = await createWorkspaceForCurrentUser(name);
    if (!workspace) return { error: "We couldn’t create your workspace. Please try again." };
  } catch {
    return { error: "We couldn’t create your workspace. Please try again." };
  }

  redirect(`/onboarding?workspaceId=${encodeURIComponent(workspace.id)}`);
}
