ALTER TABLE "workspace" ADD COLUMN "digest_lease_token" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "digest_lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "digest_last_attempt_at" timestamp with time zone;