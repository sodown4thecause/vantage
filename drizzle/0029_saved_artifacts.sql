CREATE TABLE "saved_artifact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"lane" text NOT NULL,
	"title" text NOT NULL,
	"blocks" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_artifact_lane_check" CHECK ("saved_artifact"."lane" in ('gtm', 'seo', 'geo', 'content'))
);
--> statement-breakpoint
ALTER TABLE "saved_artifact" ADD CONSTRAINT "saved_artifact_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_artifact_workspace_created_idx" ON "saved_artifact" USING btree ("workspace_id","created_at");