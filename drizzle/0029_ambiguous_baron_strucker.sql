CREATE TYPE "public"."content_ledger_source" AS ENUM('sitemap', 'published', 'manual');--> statement-breakpoint
CREATE TYPE "public"."content_profile_status" AS ENUM('draft', 'approved');--> statement-breakpoint
CREATE TABLE "content_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"url" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"target_keyword" text,
	"secondary_keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published_date" date,
	"refresh_date" date,
	"embedding_id" text,
	"source" "content_ledger_source" DEFAULT 'sitemap' NOT NULL,
	"asset_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"status" "content_profile_status" DEFAULT 'draft' NOT NULL,
	"audience" text DEFAULT '' NOT NULL,
	"facts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"banned_claims" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"voice_samples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"banned_phrases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"house_style" text DEFAULT '' NOT NULL,
	"competitors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"draft" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_pages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approved_hash" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_usage" ADD COLUMN "content_posts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "content_ledger" ADD CONSTRAINT "content_ledger_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_profiles" ADD CONSTRAINT "content_profiles_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "content_ledger_workspace_url_uidx" ON "content_ledger" USING btree ("workspace_id","url");--> statement-breakpoint
CREATE UNIQUE INDEX "content_ledger_workspace_id_uidx" ON "content_ledger" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_profile_workspace_uidx" ON "content_profiles" USING btree ("workspace_id");