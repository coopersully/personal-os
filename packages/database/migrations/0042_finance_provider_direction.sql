ALTER TABLE "finance_transactions"
	ADD COLUMN "provider_direction" text;
--> statement-breakpoint
-- Existing posted provider-backed non-transfer rows already encode the last
-- known provider sign in direction. Preserve that comparison baseline so the
-- first sync after this migration can detect a provider sign correction.
UPDATE "finance_transactions"
SET "provider_direction" = "direction"
WHERE
	"pending" = false
	AND "provider_transaction_id" IS NOT NULL
	AND "direction" IN ('expense', 'income');
--> statement-breakpoint
ALTER TABLE "finance_transactions"
	ADD CONSTRAINT "finance_transactions_provider_direction_check"
	CHECK ("provider_direction" IS NULL OR "provider_direction" IN ('expense', 'income'));
