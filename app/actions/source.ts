"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { authorizeWorkspace } from "@/lib/auth/workspace";
import { isSourceType, validateSourceConfig } from "@/lib/collectors/config";
import { getDb } from "@/lib/db/client";
import { source } from "@/lib/db/schema";

export type SourceFormState = { error: string | null; saved?: boolean };

function formText(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function createSource(
  _previous: SourceFormState,
  formData: FormData,
): Promise<SourceFormState> {
  const workspaceId = formText(formData, "workspaceId");
  const name = formText(formData, "name");
  const type = formData.get("type");

  if (!workspaceId) return { error: "Missing workspace." };
  if (!name || name.length < 2) {
    return { error: "Give the source a name of at least 2 characters." };
  }
  if (name.length > 60) {
    return { error: "Keep the source name under 60 characters." };
  }
  if (!isSourceType(type)) return { error: "Choose a source type." };

  const authorization = await authorizeWorkspace(workspaceId);
  if (!authorization.ok) {
    return { error: "Not authorized for this workspace." };
  }

  const validated = validateSourceConfig(
    type,
    Object.fromEntries(formData.entries()),
  );
  if (!validated.ok) return { error: validated.error };

  try {
    const db = getDb();
    await db
      .insert(source)
      .values({
        workspaceId,
        name,
        type,
        lane: "free",
        config: validated.config,
      })
      .onConflictDoNothing({
        target: [source.workspaceId, source.name],
      });
  } catch (err) {
    console.error("[source action] create failed", {
      workspaceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { error: "Could not save the source. Please try again." };
  }

  revalidatePath("/sources");
  return { error: null, saved: true };
}

export async function setSourcePaused(
  _previous: SourceFormState,
  formData: FormData,
): Promise<SourceFormState> {
  const workspaceId = formText(formData, "workspaceId");
  const sourceId = formText(formData, "sourceId");
  const paused = formData.get("paused") === "true";

  if (!workspaceId || !sourceId) return { error: "Missing source reference." };

  const authorization = await authorizeWorkspace(workspaceId);
  if (!authorization.ok) {
    return { error: "Not authorized for this workspace." };
  }

  try {
    const db = getDb();
    await db
      .update(source)
      .set({ health: paused ? "paused" : "healthy", updatedAt: new Date() })
      .where(and(eq(source.id, sourceId), eq(source.workspaceId, workspaceId)));
  } catch (err) {
    console.error("[source action] pause failed", {
      workspaceId,
      sourceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { error: "Could not update the source. Please try again." };
  }

  revalidatePath("/sources");
  return { error: null, saved: true };
}
