import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/neon-http";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";
import { recordWorkspaceTopicVolume, topicVolumeWindow } from "@/lib/trends/volume";

const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/lib/db/client", () => ({ getDb: () => state.db }));

type Query = { text: string; params: never[]; options: { arrayMode: boolean } };
const workspaceId = "00000000-0000-0000-0000-000000000001";
const otherWorkspaceId = "00000000-0000-0000-0000-000000000002";
const now = new Date("2026-10-25T14:45:00Z");

function database(transaction: (queries: Query[]) => Promise<unknown[]>) {
  return drizzle({ client: {
    query: (text: string, params: never[], options: Query["options"]) => ({ text, params, options }),
    transaction,
  } as never, schema });
}

describe("topic volume batch contract", () => {
  it("locks the workspace before atomically claiming and counting documents", async () => {
    let queries: Query[] = [];
    state.db = database(async (batch) => {
      queries = batch;
      return [{ rows: [] }, { rows: [{ topic: "CRM" }] }];
    });
    expect(await recordWorkspaceTopicVolume(workspaceId, ["CRM"], { now })).toBe(1);
    expect(queries).toHaveLength(2);
    expect(queries[0].text).toContain('where "workspace"."id" = $1 for update');
    expect(queries[0].params).toEqual([workspaceId]);
    expect(queries[1].text).toContain("claimed as (");
    expect(queries[1].text).toContain("topicVolumeTopics");
    expect(queries[1].text).toContain("@> to_jsonb(wanted.topic)");
    expect(queries[1].text).toContain("from claimed");
    expect(queries[1].text).toContain("at time zone 'UTC'");
    expect(queries[1].text).not.toMatch(/limit|is not true/i);
    expect(queries[1].params).toContain(workspaceId);
  });

  it("uses the same midnight-aligned bounds for deletion and rebuilding", async () => {
    let queries: Query[] = [];
    state.db = database(async (batch) => {
      queries = batch;
      return [{ rows: [] }, { rows: [] }, { rows: [] }];
    });
    await recordWorkspaceTopicVolume(workspaceId, ["CRM"], { now, rebuild: true });
    expect(queries).toHaveLength(3);
    expect(queries[1].params).toEqual([workspaceId, "2026-09-28", "2026-10-26"]);
    expect(queries[2].params).toContain("2026-09-28T00:00:00.000Z");
    expect(queries[2].params).toContain("2026-10-26T00:00:00.000Z");
    expect(queries[2].text).not.toContain("is distinct from");
    expect(topicVolumeWindow(now)).toEqual({ since: "2026-09-28T00:00:00.000Z", until: "2026-10-26T00:00:00.000Z" });
  });
});

describe.skipIf(!process.env.TOPIC_VOLUME_TEST_DATABASE_URL)("topic volume PostgreSQL regressions", () => {
  const namespace = `topic_volume_${randomUUID().replaceAll("-", "")}`;
  const pg = postgres(process.env.TOPIC_VOLUME_TEST_DATABASE_URL ?? "postgres://localhost/unused", {
    connection: { search_path: namespace, timezone: "Australia/Brisbane" },
    types: {
      jsonb: { to: 3802, from: [3802], serialize: (value: unknown) => typeof value === "string" ? value : JSON.stringify(value), parse: JSON.parse },
    },
  });

  beforeAll(async () => {
    await pg.unsafe(`create schema ${namespace}`);
    await pg.unsafe(`
      create table workspace (id uuid primary key);
      create table document (
        id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspace,
        platform text not null, posted_at timestamptz, collected_at timestamptz not null,
        title text, content_md text not null, metadata jsonb
      );
      create table topic_volume_daily (
        workspace_id uuid not null references workspace, topic text not null, source text not null,
        day date not null, mentions integer not null, primary key (workspace_id, topic, source, day)
      );
    `);
    await pg`insert into workspace values (${workspaceId}), (${otherWorkspaceId})`;
    state.db = database((queries) => pg.begin(async (tx) => {
      const results = [];
      for (const query of queries) {
        const rows = await tx.unsafe(query.text, query.params);
        results.push({ rows: query.options.arrayMode ? rows.map((row) => Object.values(row)) : rows });
      }
      return results;
    }) as Promise<unknown[]>);
  });

  afterAll(async () => {
    await pg.unsafe(`drop schema if exists ${namespace} cascade`);
    await pg.end();
  });

  it("rebuilds more than 2000 documents, preserves UTC boundaries and scopes markers", async () => {
    await pg`insert into document (workspace_id, platform, posted_at, collected_at, content_md, metadata)
      select ${workspaceId}, 'reddit', '2026-09-28T00:00:00Z', ${now}, 'CRM and C++', '{"keep":1}'::jsonb
      from generate_series(1, 2001)`;
    await pg`insert into document (workspace_id, platform, posted_at, collected_at, content_md, metadata) values
      (${workspaceId}, 'hn', null, '2026-10-25T23:59:59Z', 'CRM', null),
      (${workspaceId}, 'hn', '2026-09-27T23:59:59Z', ${now}, 'CRM', '{}'),
      (${workspaceId}, 'hn', '2026-10-26T00:00:00Z', ${now}, 'CRM', '{}'),
      (${otherWorkspaceId}, 'hn', ${now}, ${now}, 'CRM', '{}'),
      (${workspaceId}, 'hn', ${now}, ${now}, 'unmatched', '{}')`;
    await recordWorkspaceTopicVolume(workspaceId, ["CRM", "C++"], { now, rebuild: true });
    const rows = await pg`select topic, source, day::text, mentions from topic_volume_daily order by topic, source`;
    expect([...rows]).toEqual([
      { topic: "C++", source: "reddit", day: "2026-09-28", mentions: 2001 },
      { topic: "CRM", source: "hn", day: "2026-10-25", mentions: 1 },
      { topic: "CRM", source: "reddit", day: "2026-09-28", mentions: 2001 },
    ]);
    expect((await pg`select count(*)::int as n from document where metadata->'topicVolumeTopics' @> '"CRM"'::jsonb and metadata->'topicVolumeTopics' @> '"C++"'::jsonb`)[0].n).toBe(2003);
    expect((await pg`select count(*)::int as n from document where metadata->>'keep' = '1'`)[0].n).toBe(2001);
    expect(await recordWorkspaceTopicVolume(workspaceId, ["CRM", "C++"], { now })).toBe(0);
  });

  it("serializes overlapping scans and rebuilds without double counts", async () => {
    await pg`insert into document (workspace_id, platform, collected_at, content_md, metadata)
      values (${workspaceId}, 'reddit', '2026-09-28T01:00:00Z', 'CRM', '{"topicVolumeRecorded":false}')`;
    await Promise.all([
      recordWorkspaceTopicVolume(workspaceId, ["CRM", "C++"], { now }),
      recordWorkspaceTopicVolume(workspaceId, ["CRM", "C++"], { now }),
    ]);
    expect((await pg`select mentions from topic_volume_daily where workspace_id = ${workspaceId} and topic = 'CRM' and source = 'reddit'`)[0].mentions).toBe(2002);
    await Promise.all([
      recordWorkspaceTopicVolume(workspaceId, ["CRM", "C++"], { now }),
      recordWorkspaceTopicVolume(workspaceId, ["CRM", "C++"], { now, rebuild: true }),
      recordWorkspaceTopicVolume(workspaceId, ["CRM", "C++"], { now }),
    ]);
    expect((await pg`select mentions from topic_volume_daily where workspace_id = ${workspaceId} and topic = 'CRM' and source = 'reddit'`)[0].mentions).toBe(2002);
  });

  it("counts stored documents for a topic added after they were first scanned", async () => {
    await pg`insert into document (workspace_id, platform, collected_at, content_md, metadata)
      values (${workspaceId}, 'devto', '2026-10-20T01:00:00Z', 'CRM and Kubernetes', '{}')`;
    await recordWorkspaceTopicVolume(workspaceId, ["CRM"], { now });
    await recordWorkspaceTopicVolume(workspaceId, ["CRM", "Kubernetes"], { now });
    await recordWorkspaceTopicVolume(workspaceId, ["CRM", "Kubernetes"], { now });
    const rows = await pg`select topic, mentions from topic_volume_daily where source = 'devto' order by topic`;
    expect([...rows]).toEqual([
      { topic: "CRM", mentions: 1 },
      { topic: "Kubernetes", mentions: 1 },
    ]);
  });

  it("rolls back deleted counts and claimed markers when a rebuild fails", async () => {
    await pg`insert into document (workspace_id, platform, collected_at, content_md, metadata)
      values (${workspaceId}, 'reddit', '2026-09-28T01:00:00Z', 'CRM', '{"keep":2}')`;
    await pg`alter table topic_volume_daily add constraint reject_large_count check (mentions < 2000) not valid`;
    await expect(recordWorkspaceTopicVolume(workspaceId, ["CRM", "C++"], { now })).rejects.toThrow();
    await expect(recordWorkspaceTopicVolume(workspaceId, ["CRM", "C++"], { now, rebuild: true })).rejects.toThrow();
    expect((await pg`select mentions from topic_volume_daily where workspace_id = ${workspaceId} and topic = 'CRM' and source = 'reddit'`)[0].mentions).toBe(2002);
    expect((await pg`select metadata from document where metadata->>'keep' = '2'`)[0].metadata).toEqual({ keep: 2 });
    await pg`alter table topic_volume_daily drop constraint reject_large_count`;
  });
});
