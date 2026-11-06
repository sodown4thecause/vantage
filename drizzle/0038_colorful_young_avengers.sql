CREATE TABLE "agent_registration_day" (
	"day" date NOT NULL,
	"scope" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "agent_registration_day_day_scope_pk" PRIMARY KEY("day","scope")
);
