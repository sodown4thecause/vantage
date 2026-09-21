CREATE TYPE "public"."opportunity_outcome_event" AS ENUM('useful', 'not_useful', 'saved', 'rejected', 'acted_on', 'draft_edit', 'published_url', 'utm_click', 'conversion');--> statement-breakpoint
CREATE TABLE "opportunity_outcome" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"draft_id" uuid,
	"event" "opportunity_outcome_event" NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opportunity_outcome" ADD CONSTRAINT "opportunity_outcome_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_outcome" ADD CONSTRAINT "opportunity_outcome_opportunity_id_opportunity_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_outcome" ADD CONSTRAINT "opportunity_outcome_draft_id_opportunity_draft_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."opportunity_draft"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_outcome_idem_uidx" ON "opportunity_outcome" USING btree ("workspace_id","idempotency_key");