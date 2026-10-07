CREATE TYPE "public"."play_effort" AS ENUM('s', 'm', 'l');--> statement-breakpoint
CREATE TYPE "public"."play_kind" AS ENUM('reply_brief', 'directory_submission', 'comparison_page', 'migration_guide', 'importer', 'integration', 'outreach', 'trial_offer', 'newsletter_pitch');--> statement-breakpoint
CREATE TYPE "public"."play_status" AS ENUM('suggested', 'accepted', 'done', 'dismissed');--> statement-breakpoint
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
ALTER TABLE "play" ADD CONSTRAINT "play_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play" ADD CONSTRAINT "play_opportunity_id_opportunity_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play" ADD CONSTRAINT "play_destination_id_destination_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destination"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "play_workspace_opportunity_idx" ON "play" USING btree ("workspace_id","opportunity_id");