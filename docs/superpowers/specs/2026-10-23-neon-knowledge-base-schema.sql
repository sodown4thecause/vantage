CREATE TYPE kb_tier AS ENUM ('A', 'B', 'C', 'D');
CREATE TYPE kb_hub AS ENUM ('gtm', 'seo-geo', 'content', 'coding', 'community-rules');
CREATE TYPE kb_scope AS ENUM ('global', 'private');

CREATE TABLE kb_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  source_url text NOT NULL,
  title text,
  published_at timestamptz,
  captured_at timestamptz DEFAULT now() NOT NULL,
  tier kb_tier NOT NULL,
  hub kb_hub NOT NULL,
  scope kb_scope DEFAULT 'private' NOT NULL,
  approved boolean DEFAULT false NOT NULL,
  workspace_id uuid REFERENCES workspace(id) ON DELETE CASCADE,
  content_hash text NOT NULL,
  CONSTRAINT kb_documents_scope_workspace_check CHECK ((scope = 'global' AND workspace_id IS NULL AND approved) OR (scope = 'private' AND workspace_id IS NOT NULL))
);

CREATE INDEX kb_documents_workspace_hub_published_idx ON kb_documents (workspace_id, hub, published_at);
CREATE INDEX kb_documents_workspace_source_idx ON kb_documents (workspace_id, source_url);

CREATE TABLE kb_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  document_id uuid NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
  ord integer NOT NULL,
  header text DEFAULT '' NOT NULL,
  text text NOT NULL,
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(header, '') || ' ' || text)) STORED NOT NULL,
  embedding halfvec(1024),
  chunker_version text NOT NULL,
  content_hash text NOT NULL
);

CREATE UNIQUE INDEX kb_chunks_document_ord_uidx ON kb_chunks (document_id, ord);
CREATE INDEX kb_chunks_tsv_gin_idx ON kb_chunks USING gin (tsv);
CREATE INDEX kb_chunks_embedding_hnsw_idx ON kb_chunks USING hnsw (embedding halfvec_cosine_ops);
