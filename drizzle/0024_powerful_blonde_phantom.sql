CREATE TABLE "dataforseo_cache" (
	"cache_key" text PRIMARY KEY NOT NULL,
	"endpoint" text NOT NULL,
	"response_json" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_usage" ADD COLUMN "seo_credits" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "dataforseo_cache_expires_idx" ON "dataforseo_cache" USING btree ("expires_at");--> statement-breakpoint
INSERT INTO "plan_limit" ("plan", "key", "value") VALUES
	('free', 'seo_credits_per_month', 6),
	('pro', 'seo_credits_per_month', 60)
ON CONFLICT ("plan", "key") DO NOTHING;