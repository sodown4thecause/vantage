CREATE TABLE "dataforseo_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cache_key" text NOT NULL,
	"endpoint" text NOT NULL,
	"response_json" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "dataforseo_snapshot_key_fetched_idx" ON "dataforseo_snapshot" USING btree ("cache_key","fetched_at");