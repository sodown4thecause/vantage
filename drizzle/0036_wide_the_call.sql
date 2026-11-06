CREATE TABLE "agent_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event" text NOT NULL,
	"client_id" text,
	"user_id" text,
	"workspace_id" uuid,
	"registration_id" uuid,
	"ip_hash" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_authorization_code" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" uuid,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"code_challenge_method" text DEFAULT 'S256' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_client" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"redirect_uris" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "oauth_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"kind" text NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text,
	"workspace_id" uuid,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"rotated_from" uuid,
	"family_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_token_kind_check" CHECK ("oauth_token"."kind" in ('access', 'refresh'))
);
--> statement-breakpoint
ALTER TABLE "agent_audit_log" ADD CONSTRAINT "agent_audit_log_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_authorization_code" ADD CONSTRAINT "oauth_authorization_code_client_id_oauth_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_authorization_code" ADD CONSTRAINT "oauth_authorization_code_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_token" ADD CONSTRAINT "oauth_token_client_id_oauth_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_token" ADD CONSTRAINT "oauth_token_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_audit_log_created_idx" ON "agent_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "agent_audit_log_event_created_idx" ON "agent_audit_log" USING btree ("event","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_authorization_code_hash_uidx" ON "oauth_authorization_code" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "oauth_authorization_code_client_idx" ON "oauth_authorization_code" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_token_hash_uidx" ON "oauth_token" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "oauth_token_client_idx" ON "oauth_token" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_token_workspace_idx" ON "oauth_token" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "oauth_token_family_idx" ON "oauth_token" USING btree ("family_id");