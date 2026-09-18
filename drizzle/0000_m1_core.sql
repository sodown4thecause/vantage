CREATE TYPE "public"."source_type" AS ENUM('hn', 'rss', 'substack', 'reddit', 'web_search', 'other');--> statement-breakpoint
CREATE TYPE "public"."source_lane" AS ENUM('free', 'paid', 'byok');--> statement-breakpoint
CREATE TYPE "public"."source_health" AS ENUM('healthy', 'degraded', 'failing', 'paused');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('new', 'queued', 'reviewing', 'approved', 'rejected', 'posted', 'expired');--> statement-breakpoint
CREATE TABLE "workspace" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"owner_user_id" uuid,
	"plan" text DEFAULT 'free' NOT NULL,
	"budget_usd_month" numeric(12, 2) DEFAULT '0' NOT NULL,
	"byok_keys" jsonb DEFAULT '{}'::jsonb,
	"lane_consents" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"posting_health" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "source_type" NOT NULL,
	"lane" "source_lane" DEFAULT 'free' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"health" "source_health" DEFAULT 'healthy' NOT NULL,
	"etag" text,
	"last_modified" text,
	"cursor" text,
	"last_polled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_id" uuid,
	"url_canonical" text NOT NULL,
	"platform" text NOT NULL,
	"author_ref" text,
	"title" text,
	"posted_at" timestamp with time zone,
	"content_md" text DEFAULT '' NOT NULL,
	"content_hash" text NOT NULL,
	"raw_snapshot_ref" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"intent_rung" integer DEFAULT 0 NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"score" real DEFAULT 0 NOT NULL,
	"factors" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"window_minutes" integer,
	"reason" text,
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source" ADD CONSTRAINT "source_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "source_workspace_name_uidx" ON "source" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "document_workspace_hash_uidx" ON "document" USING btree ("workspace_id","content_hash");
