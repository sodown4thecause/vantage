"use server";

import { redirect } from "next/navigation";

import { agentRegistrationEnabled, agentTokenPepper } from "@/lib/agent/config";
import { drizzleAgentStore } from "@/lib/agent/oauth/store";
import { completeClaim, drizzleRegistrationStore } from "@/lib/agent/registration";
import { safeGetSession } from "@/lib/auth/server";
import { getCurrentWorkspace } from "@/lib/auth/workspace";

const back = (attemptId: string, error?: string) =>
  `/auth-agents/claim?attempt=${encodeURIComponent(attemptId)}${error ? `&error=${error}` : ""}`;

/**
 * Completes a claim. Every check is repeated here: the page's rendering proves
 * nothing about the submitted form. Next.js verifies the request origin for
 * server actions, which is the CSRF defence.
 */
export async function completeClaimAction(formData: FormData) {
  if (!agentRegistrationEnabled()) redirect("/");

  const attemptId = String(formData.get("attempt") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim();
  if (!attemptId) redirect("/auth-agents/claim");
  if (!/^\d{6}$/.test(code)) redirect(back(attemptId, "invalid_code"));

  const { data: session } = await safeGetSession();
  const userId = session?.user?.id;
  if (!userId) redirect(back(attemptId));

  // v1 refuses rather than merging: a surprise second workspace is worse than a
  // clear message.
  const existing = await getCurrentWorkspace();
  if (existing) redirect(back(attemptId, "already_claimed"));

  const pepper = agentTokenPepper();
  if (!pepper) redirect("/");

  const result = await completeClaim({
    store: drizzleRegistrationStore(),
    attemptId,
    userCode: code,
    userId: String(userId),
    userEmail: session?.user?.email ?? null,
    plan: "free",
    pepper,
    now: new Date(),
  });
  if (!result.ok) redirect(back(attemptId, result.error));

  await drizzleAgentStore().audit({
    event: "workspace_claimed",
    userId: String(userId),
    workspaceId: result.workspaceId,
    detail: { attemptId },
  });

  redirect(`/queue?workspaceId=${encodeURIComponent(result.workspaceId)}`);
}
