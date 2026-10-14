CREATE TABLE "billing_order" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"polar_customer_id" text,
	"product_id" text,
	"subscription_id" text,
	"status" text NOT NULL,
	"total_amount" integer,
	"currency" text,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"polar_customer_id" text NOT NULL,
	"product_id" text NOT NULL,
	"plan" text,
	"status" text NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"current_period_end" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"polar_modified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_webhook_event" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "billing_order_user_idx" ON "billing_order" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "billing_subscription_user_idx" ON "billing_subscription" USING btree ("user_id");