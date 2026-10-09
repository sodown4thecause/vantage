CREATE TYPE "public"."opportunity_outcome_type" AS ENUM('useful', 'not_useful', 'acted_on');--> statement-breakpoint
CREATE TABLE "opportunity_outcome" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL REFERENCES "public"."workspace" ("id") ON DELETE cascade,
	"lead_id" uuid NOT NULL REFERENCES "public"."lead" ("id") ON DELETE cascade,
	"outcome_type" "public"."opportunity_outcome_type" NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_outcome_workspace_lead_uidx" ON "public"."opportunity_outcome" USING btree ("workspace_id","lead_id");--> statement-breakpoint
CREATE TABLE "workspace_learning_weights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL REFERENCES "public"."workspace" ("id") ON DELETE cascade,
	"weights" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_learning_weights_workspace_uidx" ON "public"."workspace_learning_weights" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "opportunity_outcome" ADD CONSTRAINT "opportunity_outcome_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace" ("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_outcome" ADD CONSTRAINT "opportunity_outcome_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead" ("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_learning_weights" ADD CONSTRAINT "workspace_learning_weights_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace" ("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
