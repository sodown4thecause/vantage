"use server";

import { revalidatePath } from "next/cache";

import {
  confirmProfileProposal,
  decideCompetitor,
  decideKeyword,
  decideSourceRemoval,
  ingestReviewedSources,
  queueTermSource,
} from "@/lib/agents/discovery/apply";
import { nameFromUrl } from "@/lib/agents/discovery/profile";
import { authorizeWorkspace } from "@/lib/auth/workspace";
import { indexSavedProfile } from "@/lib/profile/index-profile";

/*
 * Server actions the workspace UIs call when the owner answers a proposal card. This is the only place a proposal is
 * applied. Each action checks the id shapes, authorises the workspace before any read or write, and returns a short
 * message in plain Australian English. Errors never leak detail.
 */

export type DiscoveryActionResult = { ok: boolean; message: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFUSED: DiscoveryActionResult = { ok: false, message: "Unable to update this workspace." };
const GONE: DiscoveryActionResult = { ok: false, message: "That suggestion has already been handled." };
const PROFILE_FIRST: DiscoveryActionResult = { ok: false, message: "Confirm your profile first, then accept this suggestion." };
const FAILED: DiscoveryActionResult = { ok: false, message: "Something went wrong. Please try again." };

async function guarded(ids: string[], work: () => Promise<DiscoveryActionResult>): Promise<DiscoveryActionResult> {
  if (!ids.every((id) => UUID_RE.test(id))) return REFUSED;
  try {
    const authorization = await authorizeWorkspace(ids[0]!);
    if (!authorization.ok) return REFUSED;
    const result = await work();
    revalidatePath("/workspace");
    return result;
  } catch {
    return FAILED;
  }
}

/** An accepted term is saved onto a new profile version; index it like any saved profile. Best effort, never undoes the owner's answer. */
async function indexNewProfileVersion(workspaceId: string, profileId: string | undefined): Promise<void> {
  if (!profileId) return;
  try { await indexSavedProfile(workspaceId, profileId); } catch { console.error("[discovery] profile index failed"); }
}

export async function confirmProposedProfile(workspaceId: string, proposalId: string): Promise<DiscoveryActionResult> {
  return guarded([workspaceId, proposalId], async () => {
    const result = await confirmProfileProposal(workspaceId, proposalId);
    if (!result.ok) return GONE;
    // Same best-effort indexing every other profile save does; a queue problem never undoes the owner's confirmation.
    try { await indexSavedProfile(workspaceId, result.profileId); } catch { console.error("[discovery] profile index failed"); }
    return { ok: true, message: "Profile saved." };
  });
}

/** Accepting a competitor also queues a search for its brand, which goes through the same quality gate as any source. */
export async function decideCompetitorProposal(workspaceId: string, competitorId: string, decision: "accepted" | "rejected"): Promise<DiscoveryActionResult> {
  return guarded([workspaceId, competitorId], async () => {
    const result = await decideCompetitor(workspaceId, competitorId, decision);
    if (!result.ok) return result.reason === "profile_required" ? PROFILE_FIRST : GONE;
    await indexNewProfileVersion(workspaceId, result.profileId);
    if (decision === "accepted" && result.value) {
      const brand = nameFromUrl(`https://${result.value}`);
      if (brand) { await queueTermSource(workspaceId, brand); await ingestReviewedSources(workspaceId); }
    }
    return { ok: true, message: decision === "accepted" ? "Competitor added." : "Competitor dismissed." };
  });
}

/** Accepting a keyword queues a Hacker News search for it. A keyword that is too generic is turned down with reasons. */
export async function decideKeywordProposal(workspaceId: string, keywordId: string, decision: "accepted" | "rejected"): Promise<DiscoveryActionResult> {
  return guarded([workspaceId, keywordId], async () => {
    const result = await decideKeyword(workspaceId, keywordId, decision);
    if (!result.ok) return result.reason === "profile_required" ? PROFILE_FIRST : GONE;
    await indexNewProfileVersion(workspaceId, result.profileId);
    if (decision === "accepted" && result.value) { await queueTermSource(workspaceId, result.value); await ingestReviewedSources(workspaceId); }
    return { ok: true, message: decision === "accepted" ? "Keyword added." : "Keyword dismissed." };
  });
}

/** Accepting pauses the source rather than deleting it. */
export async function decideSourceRemovalProposal(workspaceId: string, proposalId: string, decision: "accepted" | "dismissed"): Promise<DiscoveryActionResult> {
  return guarded([workspaceId, proposalId], async () => {
    const result = await decideSourceRemoval(workspaceId, proposalId, decision);
    if (!result.ok) return GONE;
    return { ok: true, message: decision === "accepted" ? "Source paused." : "Source kept." };
  });
}
