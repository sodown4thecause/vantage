CREATE TABLE "gtm_proposal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"strategy_version" integer NOT NULL,
	"profile_version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"prepared" jsonb NOT NULL,
	"source_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gtm_proposal_status_check" CHECK ("gtm_proposal"."status" in ('pending', 'applied', 'denied', 'superseded', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "gtm_proposal_decision" (
	"workspace_id" uuid NOT NULL,
	"request_id" text NOT NULL,
	"proposal_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"strategy_version" integer NOT NULL,
	"payload_hash" text NOT NULL,
	"actor_id" text NOT NULL,
	"approved" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gtm_proposal_decision_workspace_id_request_id_pk" PRIMARY KEY("workspace_id","request_id")
);
--> statement-breakpoint
CREATE TABLE "gtm_proposal_receipt" (
	"proposal_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"request_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"strategy_version" integer NOT NULL,
	"expertise_notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mutations_complete" boolean NOT NULL,
	"confirmed_at" timestamp with time zone NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gtm_proposal_receipt_complete_check" CHECK ("gtm_proposal_receipt"."mutations_complete")
);
--> statement-breakpoint
CREATE TABLE "gtm_strategy" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "gtm_strategy_version_check" CHECK ("gtm_strategy"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "gtm_strategy_outbox" (
	"proposal_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"strategy_version" integer NOT NULL,
	"kind" text DEFAULT 'strategy_changed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "gtm_proposal" ADD CONSTRAINT "gtm_proposal_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtm_proposal" ADD CONSTRAINT "gtm_proposal_conversation_id_seo_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."seo_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtm_proposal_decision" ADD CONSTRAINT "gtm_proposal_decision_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtm_proposal_decision" ADD CONSTRAINT "gtm_proposal_decision_proposal_id_gtm_proposal_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."gtm_proposal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtm_proposal_decision" ADD CONSTRAINT "gtm_proposal_decision_conversation_id_seo_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."seo_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtm_proposal_receipt" ADD CONSTRAINT "gtm_proposal_receipt_proposal_id_gtm_proposal_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."gtm_proposal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtm_proposal_receipt" ADD CONSTRAINT "gtm_proposal_receipt_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtm_proposal_receipt" ADD CONSTRAINT "gtm_proposal_receipt_conversation_id_seo_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."seo_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtm_strategy" ADD CONSTRAINT "gtm_strategy_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtm_strategy_outbox" ADD CONSTRAINT "gtm_strategy_outbox_proposal_id_gtm_proposal_receipt_proposal_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."gtm_proposal_receipt"("proposal_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtm_strategy_outbox" ADD CONSTRAINT "gtm_strategy_outbox_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gtm_proposal_scope_idx" ON "gtm_proposal" USING btree ("workspace_id","conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gtm_proposal_receipt_request_uidx" ON "gtm_proposal_receipt" USING btree ("workspace_id","request_id");