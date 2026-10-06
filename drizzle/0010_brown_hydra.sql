ALTER TABLE "workspace" ADD COLUMN "scan_lease_token" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "scan_lease_until" timestamp with time zone;