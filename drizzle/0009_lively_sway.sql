CREATE TABLE "workspace_preference_model" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"weights" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"positive_events" integer DEFAULT 0 NOT NULL,
	"negative_events" integer DEFAULT 0 NOT NULL,
	"evidence" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"disabled_reason" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_preference_model" ADD CONSTRAINT "workspace_preference_model_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_preference_model_version_uidx" ON "workspace_preference_model" USING btree ("workspace_id","version");