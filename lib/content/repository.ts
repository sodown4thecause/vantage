import { createHash } from "node:crypto";

import { and, asc, eq, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { rowsOf } from "@/lib/db/rows";
import {
  contentLedger,
  contentProfile,
  type ContentLedgerRow,
  type ContentProfile,
} from "@/lib/db/schema";

export type ProfileDraft = {
  audience: string;
  facts: string[];
  bannedClaims: string[];
  voiceSamples: string[];
  bannedPhrases: string[];
  houseStyle: string;
  competitors: string[];
};

export type LedgerSeedRow = {
  url: string;
  title?: string;
  targetKeyword?: string | null;
  publishedDate?: string | null;
};

/** SHA-256 over the canonical JSON of the owner-visible profile fields. */
export function profileHash(profile: {
  audience: string;
  facts: string[];
  bannedClaims: string[];
  voiceSamples: string[];
  bannedPhrases: string[];
  houseStyle: string;
  competitors: string[];
}): string {
  return createHash("sha256").update(JSON.stringify(profile)).digest("hex");
}

/** The workspace's content profile, at most one row. */
export async function getContentProfile(workspaceId: string): Promise<ContentProfile | null> {
  const rows = await getDb()
    .select()
    .from(contentProfile)
    .where(eq(contentProfile.workspaceId, workspaceId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Create the profile row when setup first reaches it. Never overwrites an existing
 * row: the owner's edits live there, and a re-run only refreshes the crawl provenance
 * it is explicitly given.
 */
export async function ensureContentProfile(
  workspaceId: string,
  sourcePages: Array<{ url: string; title: string; scrapedAt: string }> = [],
): Promise<ContentProfile> {
  const existing = await getContentProfile(workspaceId);
  if (existing) return existing;
  const rows = await getDb()
    .insert(contentProfile)
    .values({ workspaceId, sourcePages })
    .onConflictDoNothing()
    .returning();
  return rows[0] ?? (await getContentProfile(workspaceId))!;
}

/** Save the LLM's proposed draft without touching the owner's fields. */
export async function saveProfileDraft(workspaceId: string, draft: ProfileDraft): Promise<void> {
  await getDb()
    .update(contentProfile)
    .set({ draft, updatedAt: new Date() })
    .where(eq(contentProfile.workspaceId, workspaceId));
}

/**
 * The owner's edited profile becomes the approved one. The approved hash pins the exact
 * revision; any later edit makes the stored hash stale, and run steps must fail closed
 * when it no longer matches.
 */
export async function approveProfile(
  workspaceId: string,
  profile: ProfileDraft,
): Promise<ContentProfile | null> {
  const rows = await getDb()
    .update(contentProfile)
    .set({
      ...profile,
      status: "approved",
      approvedHash: profileHash(profile),
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(contentProfile.workspaceId, workspaceId))
    .returning();
  return rows[0] ?? null;
}

/** True when the stored hash still matches the profile's current fields. */
export function isProfileApprovalCurrent(row: ContentProfile): boolean {
  if (!row.approvedHash || row.status !== "approved") return false;
  return (
    profileHash({
      audience: row.audience,
      facts: row.facts,
      bannedClaims: row.bannedClaims,
      voiceSamples: row.voiceSamples,
      bannedPhrases: row.bannedPhrases,
      houseStyle: row.houseStyle,
      competitors: row.competitors,
    }) === row.approvedHash
  );
}

export async function listLedger(workspaceId: string): Promise<ContentLedgerRow[]> {
  return getDb()
    .select()
    .from(contentLedger)
    .where(eq(contentLedger.workspaceId, workspaceId))
    .orderBy(asc(contentLedger.url));
}

/**
 * Seed ledger rows from a site map or a published post. Every query is bound to the
 * workspace, and existing URLs are never overwritten: the owner's keyword and dates
 * stay as they are, and a re-run only adds what is new. Returns the newly added rows.
 */
export async function addLedgerRows(
  workspaceId: string,
  rows: LedgerSeedRow[],
): Promise<ContentLedgerRow[]> {
  const values = rows
    .filter((row) => typeof row.url === "string" && row.url.startsWith("http"))
    .map((row) => ({
      workspaceId,
      url: row.url,
      title: row.title ?? "",
      targetKeyword: row.targetKeyword ?? null,
      publishedDate: row.publishedDate ?? null,
    }));
  if (values.length === 0) return [];
  return getDb()
    .insert(contentLedger)
    .values(values)
    .onConflictDoNothing()
    .returning();
}

/** A ledger row by id, refusing to cross workspaces. */
export async function getLedgerRow(
  workspaceId: string,
  ledgerId: string,
): Promise<ContentLedgerRow | null> {
  const rows = await getDb()
    .select()
    .from(contentLedger)
    .where(and(eq(contentLedger.workspaceId, workspaceId), eq(contentLedger.id, ledgerId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Embedding-vector ids for the workspace's ledger, used to upsert and prune Vectorize. */
export async function ledgerVectorIds(workspaceId: string): Promise<string[]> {
  const result = await getDb().execute(sql`
    select "embedding_id" as "id" from "content_ledger"
    where "workspace_id" = ${workspaceId}::uuid and "embedding_id" is not null`);
  return rowsOf(result)
    .map((row) => {
      const id = (row as { id?: unknown }).id;
      return typeof id === "string" ? id : null;
    })
    .filter((id): id is string => id !== null);
}
