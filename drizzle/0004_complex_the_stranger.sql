CREATE TYPE "public"."outcome_type" AS ENUM('useful', 'not_useful', 'acted_on');--> statement-breakpoint
ALTER TYPE "public"."source_type" ADD VALUE IF NOT EXISTS 'x';--> statement-breakpoint
CREATE TABLE "opportunity_outcome" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"outcome_type" "outcome_type" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opportunity_outcome" ADD CONSTRAINT "opportunity_outcome_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_outcome" ADD CONSTRAINT "opportunity_outcome_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "opportunity_outcome_workspace_idx" ON "opportunity_outcome" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_outcome_lead_type_uidx" ON "opportunity_outcome" USING btree ("lead_id","outcome_type");