CREATE TYPE "public"."opportunity_status" AS ENUM('ignore', 'monitor', 'opportunity', 'review');--> statement-breakpoint
CREATE TABLE "opportunity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"status" "opportunity_status" DEFAULT 'review' NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"why_it_matters" text DEFAULT '' NOT NULL,
	"why_now" text DEFAULT '' NOT NULL,
	"recommended_action" text DEFAULT '' NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"urgency" real DEFAULT 0 NOT NULL,
	"score" real DEFAULT 0 NOT NULL,
	"coverage" text DEFAULT 'unknown' NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cluster_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_evidence" ADD CONSTRAINT "opportunity_evidence_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_evidence" ADD CONSTRAINT "opportunity_evidence_opportunity_id_opportunity_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_evidence" ADD CONSTRAINT "opportunity_evidence_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_workspace_cluster_uidx" ON "opportunity" USING btree ("workspace_id","cluster_key");--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_evidence_opp_doc_uidx" ON "opportunity_evidence" USING btree ("opportunity_id","document_id");