-- The pre-Item-aware disconnect path cleared the remote account identity and
-- local account credentials but left the canonical Item pointer intact. Detach
-- only that exact legacy shape so healthy and recoverable Plaid accounts keep
-- their source topology.
CREATE TEMPORARY TABLE "finance_legacy_disconnected_items" ON COMMIT DROP AS
SELECT DISTINCT "provider_item_record_id" AS "id"
FROM "finance_accounts"
WHERE "provider" = 'plaid'
  AND "status" = 'needs_reauth'
  AND "provider_account_id" IS NULL
  AND "provider_item_id" IS NULL
  AND "provider_item_record_id" IS NOT NULL
  AND "encrypted_credentials" IS NULL;
--> statement-breakpoint
UPDATE "finance_accounts"
SET
  "provider_item_record_id" = NULL,
  "sync_cursor" = NULL,
  "sync_claim_id" = NULL,
  "sync_claim_expires_at" = NULL,
  "sync_state" = 'blocked',
  "next_sync_at" = NULL,
  "sync_error" = 'This account was disconnected before source cleanup was available. Connect it again to resume synchronization.',
  "sync_error_code" = 'finance_account_legacy_disconnected',
  "sync_error_category" = 'authorization',
  "sync_recovery" = 'reconnect',
  "sync_failure_count" = GREATEST("sync_failure_count", 1),
  "updated_at" = GREATEST("updated_at", CURRENT_TIMESTAMP)
WHERE "provider" = 'plaid'
  AND "status" = 'needs_reauth'
  AND "provider_account_id" IS NULL
  AND "provider_item_id" IS NULL
  AND "provider_item_record_id" IS NOT NULL
  AND "encrypted_credentials" IS NULL;
--> statement-breakpoint
DELETE FROM "finance_provider_items" AS "item"
WHERE "item"."id" IN (SELECT "id" FROM "finance_legacy_disconnected_items")
  AND NOT EXISTS (
  SELECT 1
  FROM "finance_accounts" AS "account"
  WHERE "account"."provider_item_record_id" = "item"."id"
);
