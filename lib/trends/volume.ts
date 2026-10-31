import { and, eq, gte, lt, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { document, topicVolumeDaily, workspace } from "@/lib/db/schema";

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

export function topicVolumeWindow(now = new Date()): { since: string; until: string } {
  const until = new Date(now);
  until.setUTCHours(0, 0, 0, 0);
  until.setUTCDate(until.getUTCDate() + 1);
  const since = new Date(until);
  since.setUTCDate(since.getUTCDate() - 28);
  return { since: since.toISOString(), until: until.toISOString() };
}

export async function recordWorkspaceTopicVolume(
  workspaceId: string,
  topics: readonly string[],
  options: { rebuild?: boolean; now?: Date } = {},
): Promise<number> {
  if (topics.length === 0) return 0;
  const db = getDb();
  const { since, until } = topicVolumeWindow(options.now);
  const patterns = [...new Set(topics)].filter((topic) => topic.trim()).map((topic) => ({
    topic,
    pattern: `(^|[^a-z0-9])${topic.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`,
  }));
  const lock = db.select({ id: workspace.id }).from(workspace)
    .where(eq(workspace.id, workspaceId)).for("update");
  const write = db.execute(sql`
    with wanted as (
      select t.topic, t.pattern
      from jsonb_to_recordset(${JSON.stringify(patterns)}::jsonb) as t(topic text, pattern text)
    ),
    -- Per document, the topics already counted for it (metadata.topicVolumeTopics). A document is
    -- picked up again only for topics it has not been counted for, so a topic added later still
    -- gets its stored history. A rebuild ignores the record and recounts every wanted topic.
    target as (
      select d.id, ${options.rebuild ? sql`'[]'::jsonb` : sql`coalesce(d.metadata->'topicVolumeTopics', '[]'::jsonb)`} as done
      from ${document} d
      where d.workspace_id = ${workspaceId}
        and coalesce(d.posted_at, d.collected_at) >= ${since}::timestamptz
        and coalesce(d.posted_at, d.collected_at) < ${until}::timestamptz
        and ${options.rebuild ? sql`true` : sql`exists (
          select 1 from wanted
          where not (coalesce(d.metadata->'topicVolumeTopics', '[]'::jsonb) @> to_jsonb(wanted.topic))
        )`}
    ),
    claimed as (
      update ${document}
      set metadata = coalesce(${document.metadata}, '{}'::jsonb) || jsonb_build_object(
        'topicVolumeTopics',
        target.done || (select coalesce(jsonb_agg(wanted.topic), '[]'::jsonb) from wanted
          where not (target.done @> to_jsonb(wanted.topic)))
      )
      from target
      where ${document.id} = target.id and ${document.workspaceId} = ${workspaceId}
      returning ${document.platform} as platform, ${document.postedAt} as posted_at,
        ${document.collectedAt} as collected_at, ${document.title} as title, ${document.contentMd} as content_md,
        target.done as done
    )
    insert into ${topicVolumeDaily} (workspace_id, topic, source, day, mentions)
    select ${workspaceId}::uuid, wanted.topic, claimed.platform,
      (coalesce(claimed.posted_at, claimed.collected_at) at time zone 'UTC')::date, count(*)::integer
    from claimed
    cross join wanted
    where not (claimed.done @> to_jsonb(wanted.topic))
      and (coalesce(claimed.title, '') || ' ' || claimed.content_md) ~* wanted.pattern
    group by wanted.topic, claimed.platform,
      (coalesce(claimed.posted_at, claimed.collected_at) at time zone 'UTC')::date
    on conflict (workspace_id, topic, source, day)
    do update set mentions = ${topicVolumeDaily.mentions} + excluded.mentions
    returning topic
  `);
  if (options.rebuild) {
    const results = await db.batch([
      lock,
      db.delete(topicVolumeDaily).where(and(
        eq(topicVolumeDaily.workspaceId, workspaceId),
        gte(topicVolumeDaily.day, since.slice(0, 10)),
        lt(topicVolumeDaily.day, until.slice(0, 10)),
      )),
      write,
    ]);
    return results[2].rows.length;
  }
  const results = await db.batch([lock, write]);
  return results[1].rows.length;
}
