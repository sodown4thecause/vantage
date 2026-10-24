-- Prerequisite: enable pgvector 0.8.6 and pg_search on an isolated Neon branch before applying this migration.
CREATE EXTENSION IF NOT EXISTS vector VERSION '0.8.6';--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_search;--> statement-breakpoint
CREATE TYPE "public"."kb_hub" AS ENUM('gtm', 'seo-geo', 'content', 'coding', 'community-rules');--> statement-breakpoint
CREATE TYPE "public"."kb_tier" AS ENUM('A', 'B', 'C', 'D');--> statement-breakpoint
CREATE TABLE "kb_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"ord" integer NOT NULL,
	"header" text DEFAULT '' NOT NULL,
	"text" text NOT NULL,
	"embedding" halfvec(1024),
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce("header", '') || ' ' || "text")) STORED NOT NULL,
	"chunker_version" text NOT NULL,
	"content_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_url" text NOT NULL,
	"title" text,
	"published_at" timestamp with time zone,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tier" "kb_tier" NOT NULL,
	"hub" "kb_hub" NOT NULL,
	"workspace_id" uuid,
	"content_hash" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_document_id_kb_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."kb_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_documents" ADD CONSTRAINT "kb_documents_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "kb_chunks_document_ord_uidx" ON "kb_chunks" USING btree ("document_id","ord");--> statement-breakpoint
CREATE INDEX "kb_chunks_embedding_hnsw_idx" ON "kb_chunks" USING hnsw ("embedding" halfvec_cosine_ops);--> statement-breakpoint
CREATE INDEX "kb_chunks_bm25_idx" ON "kb_chunks" USING bm25 ("id","header","text") WITH (key_field='id');--> statement-breakpoint
CREATE INDEX "kb_documents_workspace_hub_published_idx" ON "kb_documents" USING btree ("workspace_id","hub","published_at");--> statement-breakpoint
CREATE INDEX "kb_documents_workspace_source_idx" ON "kb_documents" USING btree ("workspace_id","source_url");