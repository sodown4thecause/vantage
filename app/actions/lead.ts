"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { authorizeWorkspace } from "@/lib/auth/workspace";
import { getDb } from "@/lib/db/client";
import { lead } from "@/lib/db/schema";

export type LeadFormState = { error: string | null };

export const LEAD_REVIEW_STATUSES = ["approved", "rejected", "reviewing"] as const;

type LeadReviewStatus = (typeof LEAD_REVIEW_STATUSES)[number];

function isLeadReviewStatus(
  value: string | undefined,
): value is LeadReviewStatus {
  return (
    !!value && (LEAD_REVIEW_STATUSES as readonly string[]).includes(value)
  );
}

function formText(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Move a lead through the review queue, scoped to the owning workspace. */
export async function setLeadStatus(
  _previous: LeadFormState,
  formData: FormData,
): Promise<LeadFormState> {
  const workspaceId = formText(formData, "workspaceId");
  const leadId = formText(formData, "leadId");
  const status = formText(formData, "status");

  if (!workspaceId || !leadId) {
    return { error: "Missing lead reference." };
  }
  if (!isLeadReviewStatus(status)) {
    return { error: "Unknown review action." };
  }

  const authorization = await authorizeWorkspace(workspaceId);
  if (!authorization.ok) {
    return { error: "Not authorized for this workspace." };
  }

  try {
    const db = getDb();
    await db
      .update(lead)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(lead.id, leadId), eq(lead.workspaceId, workspaceId)));
  } catch (err) {
    console.error("[lead action] status update failed", {
      workspaceId,
      leadId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { error: "Could not update the lead. Please try again." };
  }

  revalidatePath("/review");
  return { error: null };
}
