ALTER TABLE "workspace_usage" ADD COLUMN "seo_questions" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
INSERT INTO "plan_limit" ("plan", "key", "value") VALUES
	('free', 'seo_questions_per_month', 10),
	('pro', 'seo_questions_per_month', 150)
ON CONFLICT ("plan", "key") DO NOTHING;