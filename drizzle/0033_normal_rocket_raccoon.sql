ALTER TYPE "public"."opportunity_outcome_event" ADD VALUE 'copy';--> statement-breakpoint
ALTER TYPE "public"."opportunity_outcome_event" ADD VALUE 'open';--> statement-breakpoint
ALTER TYPE "public"."opportunity_outcome_event" ADD VALUE 'sent';--> statement-breakpoint
ALTER TYPE "public"."opportunity_outcome_event" ADD VALUE 'replied';--> statement-breakpoint
CREATE TABLE "opportunity_pick" (
	"workspace_id" uuid NOT NULL,
	"pick_date" date NOT NULL,
	"rank" integer,
	"opportunity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunity_pick_workspace_id_pick_date_opportunity_id_pk" PRIMARY KEY("workspace_id","pick_date","opportunity_id"),
	CONSTRAINT "opportunity_pick_rank_check" CHECK ("opportunity_pick"."rank" is null or "opportunity_pick"."rank" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "opportunity_pick" ADD CONSTRAINT "opportunity_pick_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_pick" ADD CONSTRAINT "opportunity_pick_opportunity_id_opportunity_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_pick_day_rank_uidx" ON "opportunity_pick" USING btree ("workspace_id","pick_date","rank") WHERE "opportunity_pick"."rank" is not null;--> statement-breakpoint
CREATE INDEX "opportunity_pick_opportunity_idx" ON "opportunity_pick" USING btree ("workspace_id","opportunity_id");