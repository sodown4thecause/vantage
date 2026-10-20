"use server";

import { redirect } from "next/navigation";

import { setCurrentWorkspace } from "@/lib/auth/workspace";

export async function switchWorkspace(_state: { error: string }, form: FormData): Promise<{ error: string }> {
  const workspaceId = String(form.get("workspaceId") ?? "");
  if (!(await setCurrentWorkspace(workspaceId))) {
    return { error: "Unable to open this workspace. Sign in again or choose a workspace you own." };
  }
  redirect("/setup");
}
