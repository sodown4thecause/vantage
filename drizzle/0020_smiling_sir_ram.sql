ALTER TABLE "workspace" ADD COLUMN "digest_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "digest_email" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "digest_hour_utc" integer DEFAULT 13 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "digest_last_sent_at" timestamp with time zone;