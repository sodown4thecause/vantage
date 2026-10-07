-- GTM ingest schema (Neon Postgres).
-- Idempotent: safe to run repeatedly. Apply with `npm run migrate` or psql.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- sources: mirror of the config registry + conditional-GET / scheduling state.
-- The config file is the source of truth; this table tracks runtime state that
-- must not be lost between deploys (etag, lastModified, lastPolledAt).
-- ---------------------------------------------------------------------------
create table if not exists sources (
  id                    text primary key,
  name                  text        not null,
  category              text        not null,
  access_method         text        not null,
  url                   text        not null,
  poll_interval_minutes integer     not null check (poll_interval_minutes > 0),
  signal_type           text        not null,
  enabled               boolean     not null default true,
  note                  text,
  strip_params          text[]      not null default '{}',
  etag                  text,
  last_modified         text,
  last_polled_at        timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- The column was added after the table shipped; keep the migration idempotent
-- for databases created by an earlier revision of this file.
alter table sources add column if not exists strip_params text[] not null default '{}';

-- Supports "find due sources" scans efficiently.
create index if not exists sources_due_idx
  on sources (enabled, last_polled_at);

-- ---------------------------------------------------------------------------
-- items: normalized records from every source.
-- Dedup is enforced by unique constraints + ON CONFLICT DO NOTHING:
--   * primary:   (source_id, canonical_url)
--   * secondary: (source_id, title_hash) with a partial index (non-null hash)
-- A content_hash lets a later phase detect edited items without re-inserting.
-- ---------------------------------------------------------------------------
create table if not exists items (
  id            bigint generated always as identity primary key,
  source_id     text        not null,
  source_name   text        not null,
  category      text        not null,
  title         text        not null,
  url           text        not null,
  canonical_url text        not null,
  title_hash    text,
  -- Title-only, source-unscoped hash. Populated now; cross-source collapsing
  -- itself is deferred to the classification/entity-resolution phase, which will
  -- use this to join the same article seen via different sources. Never used for
  -- dedup in this phase.
  global_title_hash text,
  content_hash  text        not null,
  author        text,
  published_at  timestamptz,
  summary       text,
  raw_content   text        not null default '',
  signal_tags   text[]      not null default '{}',
  fetched_at    timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  constraint items_canonical_url_unique unique (source_id, canonical_url)
);

-- The column was added after the table shipped; keep the migration idempotent
-- for databases created by an earlier revision of this file.
alter table items add column if not exists global_title_hash text;

create unique index if not exists items_title_hash_unique
  on items (source_id, title_hash)
  where title_hash is not null;

-- Non-unique: many legitimate cross-source duplicates are expected until the
-- entity-resolution phase turns this into a join key. Not used for dedup yet.
create index if not exists items_global_title_hash_idx
  on items (global_title_hash)
  where global_title_hash is not null;

create index if not exists items_source_published_idx
  on items (source_id, published_at desc);

create index if not exists items_category_idx
  on items (category);

-- ---------------------------------------------------------------------------
-- jobs: append-only audit of every poll attempt. Kept small and queryable;
-- never blocks ingestion (writes are best-effort).
-- ---------------------------------------------------------------------------
create table if not exists jobs (
  id             bigint generated always as identity primary key,
  source_id      text        not null,
  status         text        not null,          -- ok | not-modified | error | skipped
  http_status    integer,
  item_count     integer     not null default 0,
  deduped_count  integer     not null default 0,
  duration_ms    integer     not null default 0,
  error          text,
  created_at     timestamptz not null default now()
);

create index if not exists jobs_source_created_idx
  on jobs (source_id, created_at desc);

-- ---------------------------------------------------------------------------
-- meta: small key/value store for pipeline bookkeeping. Holds e.g. the last
-- synced registry fingerprint so the 5-min poller can skip a no-op registry
-- upsert.
-- ---------------------------------------------------------------------------
create table if not exists meta (
  key        text primary key,
  value      text        not null,
  updated_at timestamptz not null default now()
);
