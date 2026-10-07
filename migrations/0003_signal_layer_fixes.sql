-- Signal layer review fixes (M1/M2/m1/m2/m4). Idempotent: safe to re-run
-- (`add column if not exists` / `create ... if not exists`). Applies on top of
-- 0001_init.sql and 0002_signal_layer.sql.

-- ---------------------------------------------------------------------------
-- m4: classification_status.
--
-- `classified_at` alone cannot distinguish a deliberate classification from a
-- transient parse failure that was frozen as an empty label set: both write
-- `classified_at = now()`. `classification_status` records the OUTCOME so failed
-- rows can be swept (`where classification_status = 'unclassified'`) and
-- re-attempted later without a full version bump.
--
-- Values:
--   'classified'   - the model returned a valid classification.
--   'unclassified' - a parse failure fell back to the empty result; retained
--                    (and `classified_at` stamped) so the row is not re-billed
--                    immediately, but swept later.
--
-- Nullable on purpose: historical rows predating this column stay null (unknown
-- status) and are NOT mistaken for a failed row. New writes always set it.
-- ---------------------------------------------------------------------------
alter table items add column if not exists classification_status text;

create index if not exists items_unclassified_status_idx
  on items (id) where classification_status = 'unclassified';

-- ---------------------------------------------------------------------------
-- M2: clusters.inactive_since.
--
-- The clustering window slides (`order by id desc limit 2000`). When an old
-- cluster stops being emitted, its members must lose their stale `cluster_id`,
-- and the `clusters` row must be marked inactive rather than silently left as a
-- live row. `inactive_since` is set at that transition and CLEARED if the
-- cluster re-forms.
-- ---------------------------------------------------------------------------
alter table clusters add column if not exists inactive_since timestamptz;

-- Fast "what is currently live" reads without scanning every historic cluster.
create index if not exists clusters_active_idx
  on clusters (id) where inactive_since is null;
