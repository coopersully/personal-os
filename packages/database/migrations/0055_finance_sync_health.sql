ALTER TABLE "finance_accounts" ADD COLUMN "sync_state" text DEFAULT 'stale' NOT NULL;
ALTER TABLE "finance_accounts" ADD COLUMN "sync_claim_id" uuid;
ALTER TABLE "finance_accounts" ADD COLUMN "sync_claim_expires_at" timestamptz;
ALTER TABLE "finance_accounts" ADD COLUMN "last_sync_attempt_at" timestamptz;
ALTER TABLE "finance_accounts" ADD COLUMN "next_sync_at" timestamptz;
ALTER TABLE "finance_accounts" ADD COLUMN "sync_error" text;
ALTER TABLE "finance_accounts" ADD COLUMN "sync_error_code" text;
ALTER TABLE "finance_accounts" ADD COLUMN "sync_error_category" text;
ALTER TABLE "finance_accounts" ADD COLUMN "sync_recovery" text;
ALTER TABLE "finance_accounts" ADD COLUMN "sync_failure_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "finance_accounts" ADD CONSTRAINT "finance_accounts_sync_state_check" CHECK (
  "finance_accounts"."sync_state" IN ('current', 'stale', 'retrying', 'blocked')
) NOT VALID;
ALTER TABLE "finance_accounts" ADD CONSTRAINT "finance_accounts_sync_claim_check" CHECK (
  ("finance_accounts"."sync_claim_id" IS NULL) = ("finance_accounts"."sync_claim_expires_at" IS NULL)
) NOT VALID;
ALTER TABLE "finance_accounts" ADD CONSTRAINT "finance_accounts_sync_failure_count_check" CHECK (
  "finance_accounts"."sync_failure_count" >= 0
) NOT VALID;
ALTER TABLE "finance_accounts" ADD CONSTRAINT "finance_accounts_sync_failure_check" CHECK (
  (
    "finance_accounts"."sync_state" IN ('current', 'stale')
    AND "finance_accounts"."sync_failure_count" = 0
    AND "finance_accounts"."sync_error" IS NULL
    AND "finance_accounts"."sync_error_code" IS NULL
    AND "finance_accounts"."sync_error_category" IS NULL
    AND "finance_accounts"."sync_recovery" IS NULL
  )
  OR (
    "finance_accounts"."sync_state" = 'retrying'
    AND "finance_accounts"."sync_failure_count" > 0
    AND "finance_accounts"."sync_error" IS NOT NULL
    AND "finance_accounts"."sync_error_code" IS NOT NULL
    AND "finance_accounts"."sync_error_category" IN ('authorization', 'configuration', 'invalid_response', 'not_found', 'rate_limited', 'rejected', 'temporary', 'transport', 'unknown')
    AND "finance_accounts"."sync_recovery" = 'automatic'
  )
  OR (
    "finance_accounts"."sync_state" = 'blocked'
    AND "finance_accounts"."sync_failure_count" > 0
    AND "finance_accounts"."sync_error" IS NOT NULL
    AND "finance_accounts"."sync_error_code" IS NOT NULL
    AND "finance_accounts"."sync_error_category" IN ('authorization', 'configuration', 'invalid_response', 'not_found', 'rate_limited', 'rejected', 'temporary', 'transport', 'unknown')
    AND "finance_accounts"."sync_recovery" IN ('operator', 'reconnect')
  )
) NOT VALID;
--> statement-breakpoint
ALTER TABLE "finance_accounts" VALIDATE CONSTRAINT "finance_accounts_sync_state_check";
ALTER TABLE "finance_accounts" VALIDATE CONSTRAINT "finance_accounts_sync_claim_check";
ALTER TABLE "finance_accounts" VALIDATE CONSTRAINT "finance_accounts_sync_failure_count_check";
ALTER TABLE "finance_accounts" VALIDATE CONSTRAINT "finance_accounts_sync_failure_check";
--> statement-breakpoint
CREATE INDEX "finance_accounts_sync_claim_idx" ON "finance_accounts" USING btree ("sync_claim_expires_at") WHERE "sync_claim_id" IS NOT NULL;
CREATE INDEX "finance_accounts_sync_due_idx" ON "finance_accounts" USING btree ("next_sync_at", "updated_at") WHERE "provider" = 'plaid' AND "next_sync_at" IS NOT NULL;
CREATE INDEX "finance_accounts_sync_initialization_idx" ON "finance_accounts" USING btree ("id") WHERE
  ("provider" = 'manual' AND "sync_state" = 'stale' AND "next_sync_at" IS NULL)
  OR
  ("provider" = 'plaid' AND "status" = 'connected' AND "sync_state" = 'stale' AND "next_sync_at" IS NULL);
