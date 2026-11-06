CREATE TABLE "decision_shadow" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" text NOT NULL,
	"mode" text NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "decision_shadow" ADD CONSTRAINT "decision_shadow_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "decision_shadow_subject_mode_uidx" ON "decision_shadow" USING btree ("workspace_id","subject_kind","subject_id","mode");