CREATE TABLE "link_enrichments" (
	"url_hash" text PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"kind" text NOT NULL,
	"title" text,
	"summary" text,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fetched_at" timestamp with time zone,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_volume_daily" (
	"workspace_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"source" text NOT NULL,
	"day" date NOT NULL,
	"mentions" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "topic_volume_daily_workspace_id_topic_source_day_pk" PRIMARY KEY("workspace_id","topic","source","day")
);
--> statement-breakpoint
ALTER TABLE "topic_volume_daily" ADD CONSTRAINT "topic_volume_daily_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "topic_volume_daily_workspace_day_idx" ON "topic_volume_daily" USING btree ("workspace_id","day");