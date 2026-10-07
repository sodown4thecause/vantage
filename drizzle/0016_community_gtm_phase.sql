ALTER TYPE "public"."source_type" ADD VALUE 'github';--> statement-breakpoint
ALTER TYPE "public"."source_type" ADD VALUE 'stackoverflow';--> statement-breakpoint
ALTER TYPE "public"."source_type" ADD VALUE 'linkedin';--> statement-breakpoint
CREATE TABLE "provider_budget_day" (
	"day" date PRIMARY KEY NOT NULL,
	"spent_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"cap_usd" numeric(12, 6) NOT NULL,
	"reservation_ref" text
);
--> statement-breakpoint
ALTER TABLE "opportunity_draft" ADD COLUMN "quality" jsonb;