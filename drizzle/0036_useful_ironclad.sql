CREATE TABLE "gtm_chat_turn" (
	"conversation_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"request_id" text NOT NULL,
	"token" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"scan_requested" boolean DEFAULT false NOT NULL,
	"job_id" text,
	"state" text DEFAULT 'running' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "gtm_chat_turn_conversation_id_request_id_pk" PRIMARY KEY("conversation_id","request_id"),
	CONSTRAINT "gtm_chat_turn_state_check" CHECK ("gtm_chat_turn"."state" in ('running', 'complete', 'interrupted'))
);
--> statement-breakpoint
DROP INDEX "scan_run_active_workspace_uidx";--> statement-breakpoint
ALTER TABLE "gtm_chat_turn" ADD CONSTRAINT "gtm_chat_turn_conversation_id_seo_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."seo_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtm_chat_turn" ADD CONSTRAINT "gtm_chat_turn_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtm_chat_turn" ADD CONSTRAINT "gtm_chat_turn_job_id_scan_run_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."scan_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gtm_chat_turn_active_uidx" ON "gtm_chat_turn" USING btree ("conversation_id") WHERE "gtm_chat_turn"."state" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "scan_run_active_workspace_uidx" ON "scan_run" USING btree ("workspace_id") WHERE "scan_run"."status" in ('queued', 'running', 'cancel_requested');