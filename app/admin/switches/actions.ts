"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/admin";
import { sourceSwitchStateValues, type SourceSwitchState } from "@/lib/db/schema";
import { isSourceSwitchKey } from "@/lib/sources/keys";
import { setSourceSwitch } from "@/lib/sources/switch";

export async function updateSwitch(form: FormData): Promise<void> {
  const adminId = await requireAdmin();
  const sourceKey = form.get("sourceKey");
  const state = form.get("state");
  if (!isSourceSwitchKey(sourceKey)) return;
  if (!(sourceSwitchStateValues as readonly unknown[]).includes(state)) return;
  const reason = String(form.get("reason") ?? "").trim().slice(0, 500);
  await setSourceSwitch({
    sourceKey,
    state: state as SourceSwitchState,
    reason,
    changedBy: adminId,
  });
  revalidatePath("/admin/switches");
  revalidatePath("/settings/sources");
}
