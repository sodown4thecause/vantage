import { and, desc, eq, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import {
  monitoringProfile,
  source,
  type MonitoringProfile,
  type NewSource,
} from "@/lib/db/schema";
import { WEB_DISCUSSIONS_PROVIDER, bareHost } from "@/lib/collectors/web-provider";
import { pickForumDomains } from "@/lib/communities/forum-packs";
import { assertWithinCount } from "@/lib/plans/limits";
import { PlanLimitError } from "@/lib/plans/types";
import { retrieveProductMaterial } from "@/lib/profile/retrieve";
import type {
  MonitoringProfileInput,
  MonitoringProfileView,
} from "@/lib/profile/types";

export function toProfileView(row: MonitoringProfile): MonitoringProfileView {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    version: row.version,
    productUrl: row.productUrl,
    docsUrls: row.docsUrls ?? [],
    productDescription: row.productDescription,
    targetCustomer: row.targetCustomer,
    competitors: row.competitors ?? [],
    topics: row.topics ?? [],
    productMaterialStatus: row.productMaterialStatus,
    productMaterialText: row.productMaterialText ?? "",
    retrievalNotes: row.retrievalNotes ?? "",
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getLatestMonitoringProfile(
  workspaceId: string,
): Promise<MonitoringProfileView | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(monitoringProfile)
    .where(eq(monitoringProfile.workspaceId, workspaceId))
    .orderBy(desc(monitoringProfile.version))
    .limit(1);
  const row = rows[0];
  return row ? toProfileView(row) : null;
}

export async function getMonitoringProfileVersion(
  workspaceId: string,
  version: number,
): Promise<MonitoringProfileView | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(monitoringProfile)
    .where(
      and(
        eq(monitoringProfile.workspaceId, workspaceId),
        eq(monitoringProfile.version, version),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row ? toProfileView(row) : null;
}

/**
 * Append a new profile version for the workspace after retrieving material.
 */
export async function saveMonitoringProfile(args: {
  workspaceId: string;
  input: MonitoringProfileInput;
  fetchImpl?: typeof fetch;
  profileId?: string;
}): Promise<MonitoringProfileView> {
  const db = getDb();
  let row: MonitoringProfile | undefined;
  if (args.profileId) {
    [row] = await db.select().from(monitoringProfile).where(and(
      eq(monitoringProfile.workspaceId, args.workspaceId), eq(monitoringProfile.id, args.profileId),
    )).limit(1);
  }
  if (!row) {
    const latest = await getLatestMonitoringProfile(args.workspaceId);
    // Plan keyword cap. Profiles saved before plans existed are grandfathered: a save may keep
    // (but not grow) the keyword count the workspace already has. Throws PlanLimitError.
    await assertWithinCount(args.workspaceId, "keywords", 0, args.input.topics.length, latest?.topics.length ?? 0);
    const nextVersion = (latest?.version ?? 0) + 1;

    const material = await retrieveProductMaterial(
      args.input,
      args.fetchImpl ?? fetch,
    );

    const insert = db
      .insert(monitoringProfile)
      .values({
        ...(args.profileId ? { id: args.profileId } : {}),
        workspaceId: args.workspaceId,
        version: nextVersion,
        productUrl: args.input.productUrl,
        docsUrls: args.input.docsUrls,
        productDescription: args.input.productDescription,
        targetCustomer: args.input.targetCustomer,
        competitors: args.input.competitors,
        topics: args.input.topics,
        productMaterialStatus: material.status,
        productMaterialText: material.text,
        retrievalNotes: material.notes,
      });
    const inserted = await (args.profileId
      ? insert.onConflictDoNothing({ target: monitoringProfile.id })
      : insert).returning();

    row = inserted[0];
    if (!row && args.profileId) {
      [row] = await db.select().from(monitoringProfile).where(and(
        eq(monitoringProfile.workspaceId, args.workspaceId), eq(monitoringProfile.id, args.profileId),
      )).limit(1);
    }
  }
  if (!row) {
    throw new Error("failed to persist monitoring profile");
  }
  if (args.profileId) {
    const latest = await getLatestMonitoringProfile(args.workspaceId);
    if (latest && latest.version > row.version) return toProfileView(row);
  }
  const topics = row.topics ?? [];
  await provisionProfileSources(args.workspaceId, topics, row.productUrl,
    [row.productDescription, row.targetCustomer, topics.join(" ")].join(" "));
  return toProfileView(row);
}

export const PROFILE_SOURCE_NAME = "Profile: Hacker News";
export const PROFILE_REDDIT_SOURCE_NAME = "Profile: Reddit";
export const PROFILE_WEB_SOURCE_NAME = "Profile: Dev forums & blogs";

type ProfileSource = Pick<NewSource, "name" | "type" | "lane" | "config">;

/**
 * Keyed profile sources, only when an operator has configured a provider that can serve them.
 * `profileText` (product and audience wording) picks the forum packs searched for the forums & blogs source.
 */
export function keyedProfileSources(topics: string[], productUrl: string | undefined, env: Record<string, string | undefined> = process.env, profileText?: string): ProfileSource[] {
  const queries = topics.slice(0, 3);
  if (!queries.length) return [];
  const tinyFish = Boolean(env.TINYFISH_API_KEY?.trim());
  const rows: ProfileSource[] = [];
  if (tinyFish || env.SCAVIO_API_KEY?.trim()) {
    rows.push({ name: PROFILE_REDDIT_SOURCE_NAME, type: "reddit", lane: "byok", config: { queries, limit: 10 } });
  }
  if (tinyFish || env.FIRECRAWL_API_KEY?.trim()) {
    const ownHost = productUrl ? bareHost(productUrl) : undefined;
    rows.push({ name: PROFILE_WEB_SOURCE_NAME, type: "web_search", lane: "byok", config: {
      provider: WEB_DISCUSSIONS_PROVIDER, queries, kinds: ["forum", "blog"], maxResults: 10, lookbackHours: 168,
      forumDomains: pickForumDomains([topics.join(" "), profileText ?? ""].join(" ")),
      // The owner's own site is never an opportunity.
      excludeHosts: ownHost ? [ownHost] : [],
    } });
  }
  return rows;
}

export async function provisionProfileSources(workspaceId: string, topics: string[], productUrl?: string, profileText?: string): Promise<void> {
  const db = getDb();
  const config = { queries: topics.slice(0, 5), maxPages: 1, enrich: false };
  await db.insert(source).values({
    workspaceId, name: PROFILE_SOURCE_NAME, type: "hn", lane: "free", config,
  }).onConflictDoUpdate({
    target: [source.workspaceId, source.name],
    set: { config: sql`${source.config} || ${JSON.stringify(config)}::jsonb`, updatedAt: new Date() },
  });

  const keyed = keyedProfileSources(topics, productUrl, undefined, profileText);
  if (!keyed.length) return;
  const existing = await db.select({ name: source.name }).from(source).where(eq(source.workspaceId, workspaceId)).limit(100);
  let count = existing.length;
  for (const row of keyed) {
    const present = existing.some(e => e.name === row.name);
    if (!present) {
      // Defaults never push a workspace past its plan; the owner can add these from the Sources page instead.
      try { await assertWithinCount(workspaceId, "sources", count); }
      catch (error) { if (error instanceof PlanLimitError) continue; throw error; }
      count++;
    }
    await db.insert(source).values({ workspaceId, ...row }).onConflictDoUpdate({
      target: [source.workspaceId, source.name],
      set: { config: sql`${source.config} || ${JSON.stringify(row.config)}::jsonb`, updatedAt: new Date() },
    });
  }
}
