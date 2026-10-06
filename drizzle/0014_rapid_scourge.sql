CREATE TABLE "budget_day" (
	"day" date PRIMARY KEY NOT NULL,
	"spent_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"cap_usd" numeric(12, 6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "public_visitor" (
	"visitor_hash" text NOT NULL,
	"day" date NOT NULL,
	"scans" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "public_visitor_visitor_hash_day_pk" PRIMARY KEY("visitor_hash","day")
);
