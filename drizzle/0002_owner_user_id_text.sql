ALTER TABLE "workspace"
  ALTER COLUMN "owner_user_id" SET DATA TYPE text
  USING "owner_user_id"::text;
