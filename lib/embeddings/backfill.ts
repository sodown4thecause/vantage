import { and, eq } from "drizzle-orm";

import { getSemanticMode } from "@/lib/cf/env";
import type { EmbedJob } from "@/lib/cf/queue";
import { getDb } from "@/lib/db/client";
import { monitoringProfile } from "@/lib/db/schema";
import { indexMaterial } from "@/lib/drafting/ground";
import { embedPendingDocuments } from "@/lib/embeddings/index-documents";
import { indexProfile } from "@/lib/embeddings/index-profile";
import { toProfileView } from "@/lib/profile/repository";

/** Documents embedded per queue message; the scan embed step covers any remainder. */
const BACKFILL_DOC_LIMIT = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validates a queue message body. IDs must be UUIDs; anything else is rejected. */
export function parseEmbedJob(body: unknown): EmbedJob | null {
  if (typeof body !== "object" || body === null) return null;
  const { type, workspaceId, profileId } = body as Record<string, unknown>;
  if (typeof workspaceId !== "string" || !UUID_RE.test(workspaceId)) return null;
  if (type === "backfill-documents") return { type, workspaceId };
  if (type === "index-profile" && typeof profileId === "string" && UUID_RE.test(profileId)) {
    return { type, workspaceId, profileId };
  }
  return null;
}

/**
 * Re-reads the profile or documents by ID and indexes them. Idempotent: vector ids are
 * deterministic (upsert, then delete stale tails) and documents are selected by `embedded_at is null`.
 * Returns null when a profile does not belong to the workspace. Throws on failure, so the queue retries.
 */
export async function runEmbedJob(job: EmbedJob): Promise<Record<string, unknown> | null> {
  // Mode "off": no AI or Vectorize calls. The message is acknowledged, not retried.
  if (getSemanticMode() === "off") return { skipped: "semantic mode off" };
  if (job.type === "backfill-documents") {
    const result = await embedPendingDocuments(job.workspaceId, { limit: BACKFILL_DOC_LIMIT });
    return { embedded: result.embedded };
  }
  const [row] = await getDb()
    .select()
    .from(monitoringProfile)
    .where(and(eq(monitoringProfile.id, job.profileId), eq(monitoringProfile.workspaceId, job.workspaceId)))
    .limit(1);
  if (!row) return null;
  const profile = toProfileView(row);
  const profileResult = await indexProfile(job.workspaceId, profile.id, profile.version, profile);
  const materialChunks = await indexMaterial(job.workspaceId, profile.id, profile.productMaterialText);
  return { profile: profileResult.indexed, material: materialChunks };
}
