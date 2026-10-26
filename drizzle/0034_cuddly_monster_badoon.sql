CREATE TABLE "content_draft" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"thread_id" uuid,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"format" text DEFAULT 'blog_post' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_draft_format_check" CHECK ("content_draft"."format" in ('blog_outline', 'blog_post', 'x_thread', 'linkedin_post', 'reddit_reply', 'hn_reply', 'newsletter_section')),
	CONSTRAINT "content_draft_status_check" CHECK ("content_draft"."status" in ('idea', 'draft', 'ready'))
);
--> statement-breakpoint
CREATE TABLE "content_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'complete' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_message_role_check" CHECK ("content_message"."role" in ('user', 'assistant')),
	CONSTRAINT "content_message_status_check" CHECK ("content_message"."status" in ('streaming', 'complete', 'incomplete', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "content_thread" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text DEFAULT 'New content draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_draft" ADD CONSTRAINT "content_draft_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_draft" ADD CONSTRAINT "content_draft_thread_id_content_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."content_thread"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_message" ADD CONSTRAINT "content_message_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_message" ADD CONSTRAINT "content_message_thread_id_content_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."content_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_thread" ADD CONSTRAINT "content_thread_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_draft_workspace_updated_idx" ON "content_draft" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "content_message_workspace_thread_created_idx" ON "content_message" USING btree ("workspace_id","thread_id","created_at");--> statement-breakpoint
CREATE INDEX "content_thread_workspace_updated_idx" ON "content_thread" USING btree ("workspace_id","updated_at");