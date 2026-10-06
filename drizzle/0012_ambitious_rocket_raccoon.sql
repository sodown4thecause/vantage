CREATE TABLE "cost_daily" (
	"day" date NOT NULL,
	"source_key" text NOT NULL,
	"provider" text NOT NULL,
	"action" text NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "cost_daily_day_source_key_provider_action_pk" PRIMARY KEY("day","source_key","provider","action")
);
