ALTER TABLE "calendar_accounts" ADD COLUMN "sync_error_code" text;
ALTER TABLE "calendar_accounts" ADD COLUMN "sync_error_category" text;
ALTER TABLE "calendar_accounts" ADD COLUMN "sync_recovery" text;
ALTER TABLE "calendar_accounts" ADD COLUMN "sync_failure_count" integer DEFAULT 0 NOT NULL;
ALTER TABLE "calendar_accounts" ADD COLUMN "last_sync_attempt_at" timestamptz;
ALTER TABLE "calendar_accounts" ADD COLUMN "next_sync_at" timestamptz;
--> statement-breakpoint
UPDATE "calendar_accounts"
SET "sync_error" = 'This connection was interrupted. ilo will retry automatically.',
    "sync_error_code" = 'legacy_sync_failure',
    "sync_error_category" = 'unknown',
    "sync_recovery" = 'automatic',
    "sync_failure_count" = 1,
    "next_sync_at" = NOW()
WHERE "provider" <> 'local' AND "sync_status" = 'error';
--> statement-breakpoint
UPDATE "calendar_accounts"
SET "next_sync_at" = NOW()
WHERE "provider" <> 'local' AND "sync_status" = 'idle' AND "next_sync_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "calendar_accounts" ADD CONSTRAINT "calendar_accounts_sync_failure_count_check" CHECK ("calendar_accounts"."sync_failure_count" >= 0) NOT VALID;
ALTER TABLE "calendar_accounts" ADD CONSTRAINT "calendar_accounts_sync_recovery_check" CHECK (
  "calendar_accounts"."provider" = 'local'
  OR (
    "calendar_accounts"."sync_failure_count" = 0
    AND "calendar_accounts"."sync_error" IS NULL
    AND "calendar_accounts"."sync_error_code" IS NULL
    AND "calendar_accounts"."sync_error_category" IS NULL
    AND "calendar_accounts"."sync_recovery" IS NULL
  )
  OR (
    "calendar_accounts"."sync_failure_count" > 0
    AND "calendar_accounts"."sync_error" IS NOT NULL
    AND "calendar_accounts"."sync_error_code" IS NOT NULL
    AND "calendar_accounts"."sync_error_category" IN ('authorization', 'configuration', 'invalid_response', 'not_found', 'rate_limited', 'rejected', 'temporary', 'transport', 'unknown')
    AND "calendar_accounts"."sync_recovery" IN ('automatic', 'operator', 'reconnect')
  )
) NOT VALID;
--> statement-breakpoint
ALTER TABLE "calendar_accounts" VALIDATE CONSTRAINT "calendar_accounts_sync_failure_count_check";
ALTER TABLE "calendar_accounts" VALIDATE CONSTRAINT "calendar_accounts_sync_recovery_check";
--> statement-breakpoint
CREATE INDEX "calendar_accounts_sync_due_idx" ON "calendar_accounts" USING btree ("sync_status", "next_sync_at");
