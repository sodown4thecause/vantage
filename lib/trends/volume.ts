import { and, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { document, topicVolumeDaily, type DocumentRecord } from "@/lib/db/schema";

export type TopicVolumeRow = {
  topic: string;
  source: string;
  day: string;
  mentions: number;
};

export type VolumeDocument = {
  platform: string;
  postedAt: Date | null;
  collectedAt: Date;
  title: string | null;
  contentMd: string;
};

/** Word-boundary, case-insensitive topic match over a document's title and text. */
export function docMatchesTopic(doc: { title: string | null; contentMd: string }, topic: string): boolean {
  const hay = `${doc.title ?? ""} ${doc.contentMd}`;
  if (!hay.trim() || !topic.trim()) return false;
  const escaped = topic.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(hay);
}

/** One row per (topic, source, day): every matched document counts, not just the top few. */
export function countTopicMentions(
  docs: readonly VolumeDocument[],
  topics: readonly string[],
): TopicVolumeRow[] {
  const counts = new Map<string, number>();
  for (const doc of docs) {
    const day = dayOfDocument(doc);
    if (!day) continue;
    for (const topic of topics) {
      if (!docMatchesTopic(doc, topic)) continue;
      const key = `${topic}\u0000${doc.platform}\u0000${day}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([key, mentions]) => {
    const [topic, source, day] = key.split("\u0000");
    return { topic, source, day, mentions };
  });
}

function dayOfDocument(doc: { postedAt: Date | null; collectedAt: Date }): string | null {
  const at = doc.postedAt ?? doc.collectedAt;
  if (!at || Number.isNaN(at.getTime())) return null;
  return at.toISOString().slice(0, 10);
}

/**
 * Upserts this scan's matched counts. Called after the collectors' filters have
 * run, so every counted document survived them. Only documents not yet counted
 * (metadata.topicVolumeRecorded) are passed in, so re-runs never double count.
 */
export async function recordTopicVolume(
  workspaceId: string,
  docs: Array<Pick<DocumentRecord, "id" | "platform" | "postedAt" | "collectedAt" | "title" | "contentMd">>,
  topics: readonly string[],
): Promise<number> {
  const rows = countTopicMentions(docs, topics);
  if (rows.length === 0) return 0;
  const db = getDb();
  await db
    .insert(topicVolumeDaily)
    .values(rows.map((row) => ({ ...row, workspaceId })))
    .onConflictDoUpdate({
      target: [topicVolumeDaily.workspaceId, topicVolumeDaily.topic, topicVolumeDaily.source, topicVolumeDaily.day],
      set: { mentions: sql`${topicVolumeDaily.mentions} + excluded.mentions` },
    });
  return rows.length;
}

/** Marks documents as counted so the next scan skips them. */
export async function markTopicVolumeRecorded(workspaceId: string, docIds: string[]): Promise<void> {
  if (docIds.length === 0) return;
  const db = getDb();
  const existing = await db
    .select({ id: document.id, metadata: document.metadata })
    .from(document)
    .where(and(eq(document.workspaceId, workspaceId), inArray(document.id, docIds)));
  await Promise.all(existing.map((row) =>
    db.update(document)
      .set({ metadata: { ...row.metadata, topicVolumeRecorded: true } })
      .where(and(eq(document.id, row.id), eq(document.workspaceId, workspaceId))),
  ));
}

/**
 * The scan job's entry point: counts every uncounted document from the last 28
 * days against the workspace's topics and marks them counted. Documents arrive
 * here only after the collectors' filters have run.
 */
export async function recordWorkspaceTopicVolume(workspaceId: string, topics: readonly string[]): Promise<number> {
  if (topics.length === 0) return 0;
  const db = getDb();
  const docs = await db
    .select({
      id: document.id,
      platform: document.platform,
      postedAt: document.postedAt,
      collectedAt: document.collectedAt,
      title: document.title,
      contentMd: document.contentMd,
    })
    .from(document)
    .where(and(
      eq(document.workspaceId, workspaceId),
      sql`${document.metadata}->>'topicVolumeRecorded' is not true`,
      sql`coalesce(${document.postedAt}, ${document.collectedAt}) >= now() - interval '28 days'`,
    ))
    .limit(500);
  const counted = await recordTopicVolume(workspaceId, docs, topics);
  await markTopicVolumeRecorded(workspaceId, docs.map((doc) => doc.id));
  return counted;
}
