CREATE TABLE "content_brand_voice_profile" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"audience" text NOT NULL,
	"purpose" text NOT NULL,
	"voice" text NOT NULL,
	"structure" text NOT NULL,
	"avoid" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sample_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_brand_voice_profile" ADD CONSTRAINT "content_brand_voice_profile_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;