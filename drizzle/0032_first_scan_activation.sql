CREATE TABLE "product_email_sent" (
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "product_email_sent_workspace_id_kind_pk" PRIMARY KEY("workspace_id","kind")
);
--> statement-breakpoint
CREATE TABLE "scan_run" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"read" integer DEFAULT 0 NOT NULL,
	"relevant" integer DEFAULT 0 NOT NULL,
	"picked" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"reserved_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"hydration_attempts" integer DEFAULT 0 NOT NULL,
	"capped" boolean DEFAULT false NOT NULL,
	"lease_token" uuid NOT NULL,
	"source_ids" jsonb,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "product_email_suppressed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "activation_email" text;--> statement-breakpoint
ALTER TABLE "product_email_sent" ADD CONSTRAINT "product_email_sent_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_run" ADD CONSTRAINT "scan_run_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scan_run_active_workspace_uidx" ON "scan_run" USING btree ("workspace_id") WHERE "scan_run"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "scan_run_workspace_idx" ON "scan_run" USING btree ("workspace_id");