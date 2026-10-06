CREATE TABLE "plan_limit" (
	"plan" text NOT NULL,
	"key" text NOT NULL,
	"value" integer NOT NULL,
	CONSTRAINT "plan_limit_plan_key_pk" PRIMARY KEY("plan","key")
);
--> statement-breakpoint
CREATE TABLE "workspace_usage" (
	"workspace_id" uuid NOT NULL,
	"period" date NOT NULL,
	"scored_leads" integer DEFAULT 0 NOT NULL,
	"deep_searches" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_usage_workspace_id_period_pk" PRIMARY KEY("workspace_id","period")
);
--> statement-breakpoint
ALTER TABLE "workspace_usage" ADD CONSTRAINT "workspace_usage_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "plan_limit" ("plan", "key", "value") VALUES
	('free', 'projects', 1),
	('free', 'keywords', 5),
	('free', 'sources', 8),
	('free', 'scored_leads_per_day', 20),
	('free', 'deep_searches_per_month', 0),
	('free', 'discovery_reports', 1),
	('free', 'reply_briefs', 0),
	('free', 'alerts_3h', 0),
	('free', 'scan_interval_hours', 24),
	('pro', 'projects', 3),
	('pro', 'keywords', 25),
	('pro', 'sources', 25),
	('pro', 'scored_leads_per_day', 100),
	('pro', 'deep_searches_per_month', 5),
	('pro', 'discovery_reports', 1),
	('pro', 'reply_briefs', 1),
	('pro', 'alerts_3h', 1),
	('pro', 'scan_interval_hours', 3)
ON CONFLICT ("plan", "key") DO NOTHING;