CREATE TABLE "opportunity_draft" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"original_text" text NOT NULL,
	"edited_text" text NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opportunity_draft" ADD CONSTRAINT "opportunity_draft_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_draft" ADD CONSTRAINT "opportunity_draft_opportunity_id_opportunity_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunity"("id") ON DELETE cascade ON UPDATE no action;