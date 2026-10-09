"use server";

import { revalidatePath } from "next/cache";

import { authorizeWorkspace } from "@/lib/auth/workspace";
import { isOutcomeType, recordOutcome } from "@/lib/outcomes/record";

export type OutcomeFormState = { error: string | null; recorded?: string };

function formText(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function recordOutcomeFromForm(
  _previous: OutcomeFormState,
  formData: FormData,
): Promise<OutcomeFormState> {
  const workspaceId = formText(formData, "workspaceId");
  const leadId = formText(formData, "leadId");
  const outcomeType = formText(formData, "outcomeType");

  if (!workspaceId || !leadId) {
    return { error: "Missing lead reference." };
  }
  if (!isOutcomeType(outcomeType)) {
    return { error: "Unknown outcome." };
  }

  const authorization = await authorizeWorkspace(workspaceId);
  if (!authorization.ok) {
    return { error: "Not authorized for this workspace." };
  }

  const result = await recordOutcome({ workspaceId, leadId, outcomeType });
  if (!result.ok) {
    return { error: result.error };
  }

  revalidatePath("/review");
  return { error: null, recorded: outcomeType };
}
