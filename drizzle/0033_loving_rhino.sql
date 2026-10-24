CREATE TYPE "public"."kb_scope" AS ENUM('global', 'private');--> statement-breakpoint
ALTER TABLE "kb_documents" ADD COLUMN "scope" "kb_scope" DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "kb_documents" ADD COLUMN "approved" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "kb_documents" ADD CONSTRAINT "kb_documents_scope_workspace_check" CHECK (("kb_documents"."scope" = 'global' and "kb_documents"."workspace_id" is null and "kb_documents"."approved") or ("kb_documents"."scope" = 'private' and "kb_documents"."workspace_id" is not null));