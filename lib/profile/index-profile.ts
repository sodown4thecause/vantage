import { after } from "next/server";

import { getSemanticMode } from "@/lib/cf/env";
import { enqueueEmbedJob } from "@/lib/cf/queue";
import { runEmbedJob } from "@/lib/embeddings/backfill";

/**
 * Best-effort: indexes the saved profile (profile vectors and product material) after the response
 * is sent. Used only when the queue is absent or rejects the message. Failures are logged by error
 * class only and never reach the client.
 */
function scheduleProfileIndex(workspaceId: string, profileId: string): void {
  const task = async () => {
    try {
      const result = await runEmbedJob({ type: "index-profile", workspaceId, profileId });
      if (result?.skipped === "unavailable") {
        console.error("[profile route] profile index unavailable");
      }
    } catch (err) {
      console.error("[profile route] material index failed", {
        error: err instanceof Error ? err.name : "unknown",
      });
    }
  };
  try {
    after(task);
  } catch {
    void task();
  }
}

/** Indexes a just-saved profile. Shared by the onboarding form route and the workspace interview. */
export async function indexSavedProfile(workspaceId: string, profileId: string): Promise<void> {
  // Mode "off" spends nothing on indexing: no queue message and no direct material indexing.
  if (getSemanticMode() === "off") return;
  // Queue first; direct material indexing only when the queue is absent or rejects the message.
  const queued = await enqueueEmbedJob({ type: "index-profile", workspaceId, profileId });
  if (!queued) scheduleProfileIndex(workspaceId, profileId);
}
