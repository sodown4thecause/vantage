"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { authorizeWorkspace } from "@/lib/auth/workspace";
import { clampHour } from "@/lib/digest/schedule";
import { getDb } from "@/lib/db/client";
import { workspace } from "@/lib/db/schema";

export type DigestFormState = { error: string | null; saved?: boolean };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formText(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Update daily digest preferences. Turning delivery off (or clearing the
 * address) is the unsubscribe path.
 */
export async function updateDigestPreferences(
  _previous: DigestFormState,
  formData: FormData,
): Promise<DigestFormState> {
  const workspaceId = formText(formData, "workspaceId");
  if (!workspaceId) return { error: "Missing workspace." };

  const authorization = await authorizeWorkspace(workspaceId);
  if (!authorization.ok) {
    return { error: "Not authorized for this workspace." };
  }

  const enabled = formData.get("digestEnabled") === "on";
  const email = formText(formData, "digestEmail");
  const hour = Number(formText(formData, "digestHourUtc") ?? "13");

  if (enabled && !email) {
    return { error: "Add an email address to receive the daily digest." };
  }
  if (email && !EMAIL_PATTERN.test(email)) {
    return { error: "That email address does not look valid." };
  }

  try {
    await getDb()
      .update(workspace)
      .set({
        digestEnabled: enabled,
        digestEmail: email ?? null,
        digestHourUtc: clampHour(hour),
        updatedAt: new Date(),
      })
      .where(eq(workspace.id, workspaceId));
  } catch (err) {
    console.error("[digest action] update failed", {
      workspaceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { error: "Could not save digest settings. Please try again." };
  }

  revalidatePath("/settings/digest");
  return { error: null, saved: true };
}

/** One-click unsubscribe from the digest email. */
export async function unsubscribeDigest(
  _previous: DigestFormState,
  formData: FormData,
): Promise<DigestFormState> {
  const workspaceId = formText(formData, "workspaceId");
  if (!workspaceId) return { error: "Missing workspace." };

  const authorization = await authorizeWorkspace(workspaceId);
  if (!authorization.ok) {
    return { error: "Not authorized for this workspace." };
  }

  try {
    await getDb()
      .update(workspace)
      .set({ digestEnabled: false, updatedAt: new Date() })
      .where(eq(workspace.id, workspaceId));
  } catch (err) {
    console.error("[digest action] unsubscribe failed", {
      workspaceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { error: "Could not unsubscribe. Please try again." };
  }

  revalidatePath("/settings/digest");
  return { error: null, saved: true };
}
