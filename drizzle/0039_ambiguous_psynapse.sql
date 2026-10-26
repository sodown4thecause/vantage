CREATE TABLE "discovery_research_result" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"request_id" text NOT NULL,
	"url" text NOT NULL,
	"unknowns" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "discovery_research_result" ADD CONSTRAINT "discovery_research_result_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_research_result_request_uidx" ON "discovery_research_result" USING btree ("workspace_id","request_id","url");