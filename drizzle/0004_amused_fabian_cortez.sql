CREATE TYPE "public"."product_material_status" AS ENUM('ok', 'inaccessible', 'manual');--> statement-breakpoint
CREATE TABLE "monitoring_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"product_url" text NOT NULL,
	"docs_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"product_description" text NOT NULL,
	"target_customer" text NOT NULL,
	"competitors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"topics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"product_material_status" "product_material_status" DEFAULT 'manual' NOT NULL,
	"product_material_text" text DEFAULT '' NOT NULL,
	"retrieval_notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "monitoring_profile" ADD CONSTRAINT "monitoring_profile_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "monitoring_profile_workspace_version_uidx" ON "monitoring_profile" USING btree ("workspace_id","version");