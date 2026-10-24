CREATE TABLE "workspace_provider_quota" (
	"workspace_id" uuid NOT NULL,
	"day" date NOT NULL,
	"provider" text NOT NULL,
	"action" text NOT NULL,
	"attempts" integer NOT NULL,
	CONSTRAINT "workspace_provider_quota_workspace_id_day_provider_action_pk" PRIMARY KEY("workspace_id","day","provider","action")
);
--> statement-breakpoint
ALTER TABLE "workspace_provider_quota" ADD CONSTRAINT "workspace_provider_quota_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;