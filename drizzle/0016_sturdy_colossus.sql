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
ALTER TABLE "destination_change" ADD CONSTRAINT "destination_change_destination_id_destination_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destination"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "destination_slug_uidx" ON "destination" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "destination_kind_idx" ON "destination" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "destination_change_dest_status_idx" ON "destination_change" USING btree ("destination_id","status");