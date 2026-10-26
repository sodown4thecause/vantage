CREATE TABLE "discovery_budget" (
	"workspace_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"period" date NOT NULL,
	"spent_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	CONSTRAINT "discovery_budget_workspace_id_scope_period_pk" PRIMARY KEY("workspace_id","scope","period"),
	CONSTRAINT "discovery_budget_scope_check" CHECK ("discovery_budget"."scope" in ('initial', 'daily_review')),
	CONSTRAINT "discovery_budget_spent_check" CHECK ("discovery_budget"."spent_usd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "discovery_evidence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"request_id" text NOT NULL,
	"url" text NOT NULL,
	"original_url" text NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	"excerpt" text NOT NULL,
	"provider" text NOT NULL,
	"content_kind" text NOT NULL,
	"status" text NOT NULL,
	"snapshot_key" text,
	"unknowns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discovery_evidence_kind_check" CHECK ("discovery_evidence"."content_kind" in ('full', 'preview') and "discovery_evidence"."status" in ('verified', 'partial'))
);
--> statement-breakpoint
CREATE TABLE "discovery_research_result" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"request_id" text NOT NULL,
	"url" text NOT NULL,
	"unknowns" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_reservation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"period" date NOT NULL,
	"request_id" text NOT NULL,
	"run_token" uuid NOT NULL,
	"estimate_usd" numeric(12, 6) NOT NULL,
	"retained_usd" numeric(12, 6) NOT NULL,
	"settled_at" timestamp with time zone,
	"outcome" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discovery_reservation_amount_check" CHECK ("discovery_reservation"."estimate_usd" > 0 and "discovery_reservation"."retained_usd" >= 0)
);
--> statement-breakpoint
ALTER TABLE "discovery_budget" ADD CONSTRAINT "discovery_budget_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_evidence" ADD CONSTRAINT "discovery_evidence_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_research_result" ADD CONSTRAINT "discovery_research_result_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_reservation" ADD CONSTRAINT "discovery_reservation_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discovery_evidence_request_idx" ON "discovery_evidence" USING btree ("workspace_id","request_id");--> statement-breakpoint
CREATE INDEX "discovery_research_result_request_idx" ON "discovery_research_result" USING btree ("workspace_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_reservation_request_uidx" ON "discovery_reservation" USING btree ("workspace_id","request_id");--> statement-breakpoint
CREATE INDEX "discovery_reservation_period_idx" ON "discovery_reservation" USING btree ("workspace_id","scope","period");