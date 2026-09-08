-- Task organization and Finance published parallel migrations with the same
-- Drizzle timestamps at 0055 and 0059. A database that applied the Task entry
-- first skipped the corresponding Finance entry. Reconcile those two atomic
-- Finance transitions without rewriting either published migration.
DO $reconcile$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_schema = 'public'
			AND table_name = 'finance_accounts'
			AND column_name = 'sync_state'
	) THEN
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

		ALTER TABLE "finance_accounts" VALIDATE CONSTRAINT "finance_accounts_sync_state_check";
		ALTER TABLE "finance_accounts" VALIDATE CONSTRAINT "finance_accounts_sync_claim_check";
		ALTER TABLE "finance_accounts" VALIDATE CONSTRAINT "finance_accounts_sync_failure_count_check";
		ALTER TABLE "finance_accounts" VALIDATE CONSTRAINT "finance_accounts_sync_failure_check";

		CREATE INDEX "finance_accounts_sync_claim_idx" ON "finance_accounts" USING btree ("sync_claim_expires_at") WHERE "sync_claim_id" IS NOT NULL;
		CREATE INDEX "finance_accounts_sync_due_idx" ON "finance_accounts" USING btree ("next_sync_at", "updated_at") WHERE "provider" = 'plaid' AND "next_sync_at" IS NOT NULL;
		CREATE INDEX "finance_accounts_sync_initialization_idx" ON "finance_accounts" USING btree ("id") WHERE
			("provider" = 'manual' AND "sync_state" = 'stale' AND "next_sync_at" IS NULL)
			OR
			("provider" = 'plaid' AND "status" = 'connected' AND "sync_state" = 'stale' AND "next_sync_at" IS NULL);
	END IF;

	IF to_regclass('public.finance_automation_settings') IS NULL THEN
		CREATE TABLE "finance_automation_settings" (
			"user_id" uuid PRIMARY KEY NOT NULL,
			"review_bypass_enabled" boolean DEFAULT false NOT NULL,
			"created_at" timestamptz DEFAULT now() NOT NULL,
			"updated_at" timestamptz DEFAULT now() NOT NULL
		);
		ALTER TABLE "finance_automation_settings" ADD CONSTRAINT "finance_automation_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $reconcile$;
