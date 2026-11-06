CREATE TABLE "agent_claim_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_id" uuid NOT NULL,
	"user_code_hash" text NOT NULL,
	"email" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_registration" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text DEFAULT 'anonymous' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"workspace_id" uuid,
	"client_id" text,
	"claim_token_hash" text NOT NULL,
	"claim_token_expires_at" timestamp with time zone NOT NULL,
	"assertion_key_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"claimed_by_user_id" text,
	"ip_hash" text,
	"tool_calls" integer DEFAULT 0 NOT NULL,
	"draft_attempts" integer DEFAULT 0 NOT NULL,
	"scans" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "oauth_token" ALTER COLUMN "client_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_token" ADD COLUMN "registration_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_claim_attempt" ADD CONSTRAINT "agent_claim_attempt_registration_id_agent_registration_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."agent_registration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_registration" ADD CONSTRAINT "agent_registration_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_registration" ADD CONSTRAINT "agent_registration_client_id_oauth_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_claim_attempt_registration_idx" ON "agent_claim_attempt" USING btree ("registration_id");--> statement-breakpoint
CREATE INDEX "agent_claim_attempt_expires_idx" ON "agent_claim_attempt" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_registration_claim_token_uidx" ON "agent_registration" USING btree ("claim_token_hash");--> statement-breakpoint
CREATE INDEX "agent_registration_status_expires_idx" ON "agent_registration" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "agent_registration_ip_created_idx" ON "agent_registration" USING btree ("ip_hash","created_at");--> statement-breakpoint
ALTER TABLE "oauth_token" ADD CONSTRAINT "oauth_token_registration_id_agent_registration_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."agent_registration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth_token_registration_idx" ON "oauth_token" USING btree ("registration_id");