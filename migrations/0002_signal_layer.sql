-- Signal layer: classification + entity resolution + cross-source clustering.
-- Idempotent: safe to run repeatedly (add column if not exists / create if not
-- exists). Applies on top of 0001_init.sql.

-- ---------------------------------------------------------------------------
-- items: classification columns.
--   signal_labels      - convenience label array for filtering/GIN index.
--   classification     - full structured payload (labels, entities, relevance,
--                        reason, uncertain, model, version). jsonb so the shape
--                        can evolve without new columns.
--   classified_at      - idempotency marker; null = not yet classified. The
--                        classifier selects `where classified_at is null`, so a
--                        re-run never re-bills an already-classified row.
--   classifier_version - prompt/model version, so a bump can mark rows stale.
--   cluster_id         - non-destructive cross-source echo hint (see clusters).
-- ---------------------------------------------------------------------------
alter table items add column if not exists signal_labels text[] not null default '{}';
alter table items add column if not exists classification jsonb;
alter table items add column if not exists classified_at timestamptz;
alter table items add column if not exists classifier_version text;
alter table items add column if not exists cluster_id bigint;

-- Fast "what still needs classifying" scans and label filtering.
create index if not exists items_unclassified_idx
  on items (id) where classified_at is null;
create index if not exists items_signal_labels_idx
  on items using gin (signal_labels);
create index if not exists items_cluster_idx
  on items (cluster_id) where cluster_id is not null;

-- ---------------------------------------------------------------------------
-- entities: canonical entity registry.
-- The alias map (code/config) is the source of truth; the LLM only *suggests*
-- mentions. `aliases` stores the raw variants that have resolved to this
-- canonical name, for audit and coverage growth.
-- ---------------------------------------------------------------------------
create table if not exists entities (
  id         bigint generated always as identity primary key,
  name       text        not null unique,
  aliases    text[]      not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- item_entities: many-to-many link, preserving the original raw mention so
-- every canonicalization is auditable.
-- ---------------------------------------------------------------------------
create table if not exists item_entities (
  item_id   bigint      not null,
  entity_id bigint      not null,
  mention   text        not null,
  created_at timestamptz not null default now(),
  primary key (item_id, entity_id)
);

create index if not exists item_entities_entity_idx
  on item_entities (entity_id);

-- ---------------------------------------------------------------------------
-- clusters: cross-source "multi-source echo" hints.
--
-- A cluster is ADVISORY, never destructive: rows are not deleted or merged.
-- `cluster_key` is the shared global_title_hash; a cluster is only formed when
-- that hash appears against >= 2 DISTINCT source ids. `confidence` reflects the
-- number of corroborating sources. The product decides what to display.
-- ---------------------------------------------------------------------------
create table if not exists clusters (
  id             bigint generated always as identity primary key,
  cluster_key    text        not null unique,
  anchor_item_id bigint      not null,
  source_ids     text[]      not null default '{}',
  source_count   integer     not null default 0,
  confidence     double precision not null default 0 check (confidence >= 0 and confidence <= 1),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists clusters_source_count_idx
  on clusters (source_count desc);

-- Cluster membership is idempotent on (cluster_id, item_id).
create table if not exists cluster_members (
  cluster_id bigint      not null,
  item_id    bigint      not null,
  created_at timestamptz not null default now(),
  primary key (cluster_id, item_id)
);

create index if not exists cluster_members_item_idx
  on cluster_members (item_id);
