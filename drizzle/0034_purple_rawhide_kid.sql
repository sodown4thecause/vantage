CREATE TABLE "gtm_chat" (
	"conversation_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"receipts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "gtm_chat_revision_check" CHECK ("gtm_chat"."revision" >= 0 and "gtm_chat"."revision" <= 200),
	CONSTRAINT "gtm_chat_messages_check" CHECK (jsonb_typeof("gtm_chat"."messages") = 'array' and jsonb_array_length("gtm_chat"."messages") <= 200 and octet_length("gtm_chat"."messages"::text) <= 524288),
	CONSTRAINT "gtm_chat_receipts_check" CHECK (jsonb_typeof("gtm_chat"."receipts") = 'object')
);
--> statement-breakpoint
ALTER TABLE "gtm_chat" ADD CONSTRAINT "gtm_chat_conversation_id_seo_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."seo_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtm_chat" ADD CONSTRAINT "gtm_chat_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;