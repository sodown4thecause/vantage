"use server";

import { redirect } from "next/navigation";

import { createWorkspaceForCurrentUser } from "@/lib/db/actions";

export type WorkspaceFormState = { error: string | null };

export async function createWorkspaceFromForm(
  _previous: WorkspaceFormState,
  formData: FormData,
): Promise<WorkspaceFormState> {
  const raw = formData.get("name");
  const name = typeof raw === "string" ? raw.trim() : "";

  if (name.length < 2) {
    return { error: "Give the workspace a name of at least 2 characters." };
  }
  if (name.length > 80) {
    return { error: "Keep the workspace name under 80 characters." };
  }

  let workspaceId: string;
  try {
    const row = await createWorkspaceForCurrentUser(name);
    workspaceId = row.id;
  } catch (err) {
    console.error("[workspace action] create failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { error: "Could not create the workspace. Please try again." };
  }

  redirect(`/review?workspaceId=${workspaceId}`);
}
