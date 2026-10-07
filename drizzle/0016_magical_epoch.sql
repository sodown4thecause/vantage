CREATE TABLE "lead_magnet_scan" (
	"workspace_id" uuid NOT NULL,
	"day" date NOT NULL,
	"scans" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_magnet_scan_workspace_id_day_pk" PRIMARY KEY("workspace_id","day")
);
--> statement-breakpoint
ALTER TABLE "lead_magnet_scan" ADD CONSTRAINT "lead_magnet_scan_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;