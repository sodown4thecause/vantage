CREATE TYPE "public"."play_effort" AS ENUM('s', 'm', 'l');--> statement-breakpoint
CREATE TYPE "public"."play_kind" AS ENUM('reply_brief', 'directory_submission', 'comparison_page', 'migration_guide', 'importer', 'integration', 'outreach', 'trial_offer', 'newsletter_pitch');--> statement-breakpoint
CREATE TYPE "public"."play_status" AS ENUM('suggested', 'accepted', 'done', 'dismissed');--> statement-breakpoint
CREATE TABLE "destination" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"kind" text NOT NULL,
	"audience_tags" text[] DEFAULT '{}' NOT NULL,
	"category_tags" text[] DEFAULT '{}' NOT NULL,
	"cost" text DEFAULT 'unknown' NOT NULL,
	"price_note" text DEFAULT '' NOT NULL,
	"listing_mode" text DEFAULT 'unknown' NOT NULL,
	"requirements" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"submissions_open" text DEFAULT 'unknown' NOT NULL,
	"submission_url" text,
	"link_attr" text DEFAULT 'unknown' NOT NULL,
	"ai_cited" text DEFAULT 'unknown' NOT NULL,
	"ai_cited_evidence" text,
	"source_url" text NOT NULL,
	"last_verified" date NOT NULL,
	"verified_by" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "destination_change" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"destination_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"proposed" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_url" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text
);
--> statement-breakpoint
CREATE TABLE "play" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"opportunity_id" uuid,
	"destination_id" uuid,
	"kind" "play_kind" NOT NULL,
	"title" text NOT NULL,
	"rationale" text DEFAULT '' NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "play_status" DEFAULT 'suggested' NOT NULL,
	"effort_estimate" "play_effort" DEFAULT 'm' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "destination_change" ADD CONSTRAINT "destination_change_destination_id_destination_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destination"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play" ADD CONSTRAINT "play_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play" ADD CONSTRAINT "play_opportunity_id_opportunity_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play" ADD CONSTRAINT "play_destination_id_destination_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destination"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "destination_slug_uidx" ON "destination" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "destination_kind_idx" ON "destination" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "destination_change_dest_status_idx" ON "destination_change" USING btree ("destination_id","status");--> statement-breakpoint
CREATE INDEX "play_workspace_opportunity_idx" ON "play" USING btree ("workspace_id","opportunity_id");