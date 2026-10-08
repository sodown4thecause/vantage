import { and, desc, eq, gt, lt } from "drizzle-orm";

import { getSemanticMode } from "@/lib/cf/env";
import type { EmbedJob } from "@/lib/cf/queue";
import { getDb } from "@/lib/db/client";
import { monitoringProfile } from "@/lib/db/schema";
import { indexMaterial } from "@/lib/drafting/ground";
import { embedPendingDocuments } from "@/lib/embeddings/index-documents";
import { indexProfile } from "@/lib/embeddings/index-profile";
import { isVectorizeAvailable } from "@/lib/embeddings/store";
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

/** The newest profile version older than this one. Its vectors are replaced when this version is indexed. */
async function previousProfileId(workspaceId: string, version: number): Promise<string | undefined> {
  const [prior] = await getDb()
    .select({ id: monitoringProfile.id })
    .from(monitoringProfile)
    .where(and(eq(monitoringProfile.workspaceId, workspaceId), lt(monitoringProfile.version, version)))
    .orderBy(desc(monitoringProfile.version))
    .limit(1);
  return prior?.id;
}

/** True when a newer version of this workspace's profile exists; its own job indexes the current vectors. */
async function hasNewerProfile(workspaceId: string, version: number): Promise<boolean> {
  const [newer] = await getDb()
    .select({ id: monitoringProfile.id })
    .from(monitoringProfile)
    .where(and(eq(monitoringProfile.workspaceId, workspaceId), gt(monitoringProfile.version, version)))
    .limit(1);
  return newer !== undefined;
}

/**
 * Re-reads the profile or documents by ID and indexes them. Idempotent: vector ids are
 * deterministic (upsert, then delete stale tails) and documents are selected by `embedded_at is null`.
 * Returns null when a profile does not belong to the workspace. Returns `skipped: "unavailable"` when
 * embedding or the vector write failed, so the caller can retry. Throws on unexpected failure.
 */
export async function runEmbedJob(job: EmbedJob, signal?: AbortSignal): Promise<Record<string, unknown> | null> {
  // Mode "off": no AI or Vectorize calls. The message is acknowledged, not retried.
  if (getSemanticMode() === "off") return { skipped: "semantic mode off" };
  // Without Vectorize nothing can be stored, so acknowledge the job instead of re-embedding it on every retry.
  if (!(await isVectorizeAvailable())) return { skipped: "vectorize unavailable" };
  if (job.type === "backfill-documents") {
    const result = await embedPendingDocuments(job.workspaceId, { limit: BACKFILL_DOC_LIMIT, signal });
    return result.skipped ? { embedded: 0, skipped: result.skipped } : { embedded: result.embedded };
  }
  const [row] = await getDb()
    .select()
    .from(monitoringProfile)
    .where(and(eq(monitoringProfile.id, job.profileId), eq(monitoringProfile.workspaceId, job.workspaceId)))
    .limit(1);
  if (!row) return null;
  const profile = toProfileView(row);
  // A retried job for an older version must not write its vectors back over the current ones.
  if (await hasNewerProfile(job.workspaceId, profile.version)) return { skipped: "superseded" };
  const prior = await previousProfileId(job.workspaceId, profile.version);
  const profileResult = await indexProfile(job.workspaceId, profile.id, profile.version, profile, prior, signal);
  const material = await indexMaterial(job.workspaceId, profile.id, profile.productMaterialText, signal, prior);
  // indexMaterial returns 0 both for empty text and for a failed write; only the latter is unavailable.
  const materialUnavailable = material === 0 && profile.productMaterialText.trim() !== "";
  const unavailable = profileResult.skipped === "unavailable" || materialUnavailable;
  return {
    profile: profileResult.indexed,
    material,
    ...(unavailable ? { skipped: "unavailable" } : {}),
  };
}
