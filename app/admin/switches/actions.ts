"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/auth/admin";
import { sourceSwitchStateValues, type SourceSwitchState } from "@/lib/db/schema";
import { isSourceSwitchKey } from "@/lib/sources/keys";
import { setSourceSwitch } from "@/lib/sources/switch";

export async function updateSwitch(form: FormData): Promise<void> {
  const adminId = await requireAdmin();
  const sourceKey = form.get("sourceKey");
  const state = form.get("state");
  if (
    !isSourceSwitchKey(sourceKey) ||
    !(sourceSwitchStateValues as readonly unknown[]).includes(state)
  ) {
    redirect("/admin/switches?status=invalid");
  }
  const reason = String(form.get("reason") ?? "").trim().slice(0, 500);
  let failed = false;
  try {
    await setSourceSwitch({
      sourceKey,
      state: state as SourceSwitchState,
      reason,
      changedBy: adminId,
    });
  } catch (err) {
    failed = true;
    console.error("[admin/switches] action failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  if (failed) redirect("/admin/switches?status=failed");
  revalidatePath("/admin/switches");
  revalidatePath("/settings/sources");
  redirect(`/admin/switches?status=saved&key=${encodeURIComponent(sourceKey)}`);
}
