import { embedTexts } from "@/lib/embeddings/embed";
import { deleteVectors, upsertVectors, type VectorItem } from "@/lib/embeddings/store";
import type { MonitoringProfileInput } from "@/lib/profile/types";

/** Upper bound on profile vectors per profile version; ids 0..63 are the only ones ever deleted. */
const MAX_PROFILE_VECTORS = 64;

function profileVectorId(profileId: string, n: number): string {
  return `profile:${profileId}:${n}`;
}

/**
 * Texts that represent a monitoring profile for semantic matching: product
 * description, target customer, each topic, and one "alternative to" line per
 * competitor. Blank entries are dropped.
 */
export function profileTexts(profile: MonitoringProfileInput): string[] {
  const candidates = [
    profile.productDescription,
    profile.targetCustomer,
    ...profile.topics,
    ...profile.competitors
      .map((competitor) => competitor.trim())
      .filter((competitor) => competitor !== "")
      .map((competitor) => `alternative to ${competitor}`),
  ];
  return candidates.map((text) => text.trim()).filter((text) => text !== "");
}

/**
 * Embeds the profile and replaces its vectors in the workspace namespace. The
 * previous version's ids are deleted when `previousProfileId` is given, otherwise
 * the current profile's own ids are cleared first so no stale vectors survive a
 * shorter re-index. Embedding runs before any deletion, so an unavailable AI
 * binding leaves the existing vectors in place.
 */
export async function indexProfile(
  workspaceId: string,
  profileId: string,
  version: number,
  profile: MonitoringProfileInput,
  previousProfileId?: string,
): Promise<{ indexed: number; skipped?: "unavailable" }> {
  void version;
  const texts = profileTexts(profile).slice(0, MAX_PROFILE_VECTORS);

  const vectors = texts.length === 0
    ? []
    : await embedTexts(texts, { workspaceId, sourceKey: "profile-index" });
  if (vectors === null) return { indexed: 0, skipped: "unavailable" };

  const items: VectorItem[] = vectors.map((values, n) => ({
    id: profileVectorId(profileId, n),
    values,
    kind: "profile",
  }));
  // Upsert first so a failed write never leaves the profile without vectors; then drop
  // whatever the new set does not overwrite (the previous version, or this profile's tail).
  const upserted = await upsertVectors(workspaceId, items);
  if (!upserted) return { indexed: 0, skipped: "unavailable" };

  const staleOwner = previousProfileId ?? profileId;
  const keep = staleOwner === profileId ? items.length : 0;
  const staleIds = Array.from({ length: MAX_PROFILE_VECTORS - keep }, (_, n) =>
    profileVectorId(staleOwner, n + keep),
  );
  const deleted = await deleteVectors(workspaceId, staleIds);
  if (!deleted) return { indexed: items.length };
  return { indexed: items.length };
}
