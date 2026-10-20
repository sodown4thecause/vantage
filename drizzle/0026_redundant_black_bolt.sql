CREATE TABLE "provider_budget_reservation" (
	"day" date NOT NULL,
	"provider" text NOT NULL,
	"spent_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"cap_usd" numeric(12, 6) NOT NULL,
	"reservation_ref" text,
	CONSTRAINT "provider_budget_reservation_day_provider_pk" PRIMARY KEY("day","provider")
);
