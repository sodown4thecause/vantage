import { getCurrentWorkspace } from "@/lib/auth/workspace";

/**
 * Where a newly paid user goes next. Everything, including onboarding (an AI
 * interview), lives in the unified workspace, so paid users always land there.
 * With no workspace yet, they go home to create one.
 */
export async function nextStepHref(): Promise<string> {
  const workspace = await getCurrentWorkspace();
  if (!workspace) return "/";
  return `/workspace?workspaceId=${encodeURIComponent(workspace.id)}`;
}
