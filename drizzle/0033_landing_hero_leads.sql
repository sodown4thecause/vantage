CREATE TABLE "hero_example" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"community" text NOT NULL,
	"title" text NOT NULL,
	"source_url" text NOT NULL,
	"excerpt" text NOT NULL,
	"posted_at" timestamp with time zone NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "public_product_lead" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"product_description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_product_lead_email_unique" UNIQUE("email")
);
