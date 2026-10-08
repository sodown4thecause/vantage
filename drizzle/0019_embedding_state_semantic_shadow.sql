CREATE TABLE "semantic_shadow" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"keyword_rung" integer NOT NULL,
	"semantic_rung" integer,
	"semantic_fit" real,
	"anchor_similarity" real,
	"mode" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "embedded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "semantic_shadow" ADD CONSTRAINT "semantic_shadow_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semantic_shadow" ADD CONSTRAINT "semantic_shadow_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "semantic_shadow_document_mode_uidx" ON "semantic_shadow" USING btree ("document_id","mode");--> statement-breakpoint
CREATE INDEX "document_unembedded_idx" ON "document" USING btree ("workspace_id") WHERE "document"."embedded_at" is null;