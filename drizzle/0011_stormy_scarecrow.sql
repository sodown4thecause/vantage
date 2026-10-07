CREATE TABLE "cost_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"workspace_id" uuid,
	"source_key" text NOT NULL,
	"provider" text NOT NULL,
	"action" text NOT NULL,
	"units" numeric(14, 4) DEFAULT '1' NOT NULL,
	"unit_cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"billable_to" text DEFAULT 'platform' NOT NULL,
	"request_ref" text,
	"ok" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_price" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"action" text NOT NULL,
	"unit_cost_usd" numeric(12, 6) NOT NULL,
	"unit" text DEFAULT 'request' NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shared_post" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"external_id" text NOT NULL,
	"url" text NOT NULL,
	"author" text,
	"community" text,
	"title" text,
	"body" text DEFAULT '' NOT NULL,
	"posted_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content_hash" text NOT NULL,
	"provider" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shared_sweep_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"communities_ok" integer DEFAULT 0 NOT NULL,
	"communities_failed" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"state" text DEFAULT 'running' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_switch" (
	"source_key" text PRIMARY KEY NOT NULL,
	"state" text DEFAULT 'on' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by" text
);
--> statement-breakpoint
ALTER TABLE "cost_event" ADD CONSTRAINT "cost_event_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cost_event_ts_idx" ON "cost_event" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "cost_event_workspace_ts_idx" ON "cost_event" USING btree ("workspace_id","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_price_uidx" ON "provider_price" USING btree ("provider","action","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "shared_post_platform_external_uidx" ON "shared_post" USING btree ("platform","external_id");--> statement-breakpoint
CREATE INDEX "shared_post_community_posted_idx" ON "shared_post" USING btree ("platform","community","posted_at");