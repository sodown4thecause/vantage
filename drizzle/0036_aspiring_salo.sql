CREATE TABLE "competitor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"positioning" text NOT NULL,
	"evidence_url" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "competitor_status_check" CHECK ("competitor"."status" in ('proposed', 'accepted', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "discovery_budget" (
	"workspace_id" uuid NOT NULL,
	"period" text NOT NULL,
	"committed_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discovery_budget_workspace_id_period_pk" PRIMARY KEY("workspace_id","period")
);
--> statement-breakpoint
CREATE TABLE "keyword_recommendation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"keyword" text NOT NULL,
	"kind" text NOT NULL,
	"rationale" text NOT NULL,
	"evidence_url" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "keyword_recommendation_status_check" CHECK ("keyword_recommendation"."status" in ('proposed', 'accepted', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "proposed_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_url" text NOT NULL,
	"product_name" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"audience" text NOT NULL,
	"pricing_tier" text NOT NULL,
	"differentiators" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence_url" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "proposed_profile_status_check" CHECK ("proposed_profile"."status" in ('proposed', 'accepted', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "source_proposal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"action" text DEFAULT 'add' NOT NULL,
	"source_id" uuid,
	"source_type" text NOT NULL,
	"name" text NOT NULL,
	"queries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rationale" text NOT NULL,
	"model_score" numeric(4, 2) DEFAULT '0' NOT NULL,
	"relevance_score" numeric(4, 2) DEFAULT '0' NOT NULL,
	"accepted" boolean DEFAULT false NOT NULL,
	"review_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"matched_terms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'reviewed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "source_proposal_action_check" CHECK ("source_proposal"."action" in ('add', 'remove')),
	CONSTRAINT "source_proposal_status_check" CHECK ("source_proposal"."status" in ('reviewed', 'rejected', 'ingested', 'removal_proposed', 'dismissed'))
);
--> statement-breakpoint
ALTER TABLE "competitor" ADD CONSTRAINT "competitor_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_budget" ADD CONSTRAINT "discovery_budget_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_recommendation" ADD CONSTRAINT "keyword_recommendation_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposed_profile" ADD CONSTRAINT "proposed_profile_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_proposal" ADD CONSTRAINT "source_proposal_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_proposal" ADD CONSTRAINT "source_proposal_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "competitor_workspace_domain_uidx" ON "competitor" USING btree ("workspace_id","domain");--> statement-breakpoint
CREATE UNIQUE INDEX "keyword_recommendation_workspace_keyword_uidx" ON "keyword_recommendation" USING btree ("workspace_id","keyword");--> statement-breakpoint
CREATE INDEX "proposed_profile_workspace_status_idx" ON "proposed_profile" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "source_proposal_workspace_name_action_uidx" ON "source_proposal" USING btree ("workspace_id","name","action");--> statement-breakpoint
CREATE INDEX "source_proposal_workspace_status_idx" ON "source_proposal" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "source_proposal_source_idx" ON "source_proposal" USING btree ("source_id");