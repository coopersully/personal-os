CREATE TABLE "finance_provider_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_item_id" text,
	"legacy_grouping_key" text,
	"encrypted_credentials" jsonb NOT NULL,
	"sync_cursor" text,
	"sync_state" text DEFAULT 'stale' NOT NULL,
	"sync_claim_id" uuid,
	"sync_claim_owner" text,
	"sync_claim_generation" integer,
	"sync_claim_started_at" timestamp with time zone,
	"sync_claim_expires_at" timestamp with time zone,
	"last_sync_attempt_at" timestamp with time zone,
	"next_sync_at" timestamp with time zone,
	"sync_error" text,
	"sync_error_code" text,
	"sync_error_category" text,
	"sync_recovery" text,
	"sync_failure_count" integer DEFAULT 0 NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_provider_items_provider_check" CHECK ("provider" = 'plaid'),
	CONSTRAINT "finance_provider_items_identity_check" CHECK (
		"provider_item_id" IS NOT NULL OR "legacy_grouping_key" IS NOT NULL
	),
	CONSTRAINT "finance_provider_items_sync_state_check" CHECK (
		"sync_state" IN ('current', 'stale', 'retrying', 'blocked')
	),
	CONSTRAINT "finance_provider_items_sync_claim_check" CHECK (
		num_nonnulls("sync_claim_id", "sync_claim_owner", "sync_claim_generation", "sync_claim_started_at", "sync_claim_expires_at") IN (0, 5)
	),
	CONSTRAINT "finance_provider_items_sync_claim_generation_check" CHECK (
		"sync_claim_generation" IS NULL OR "sync_claim_generation" >= 0
	),
	CONSTRAINT "finance_provider_items_sync_failure_count_check" CHECK (
		"sync_failure_count" >= 0
	),
	CONSTRAINT "finance_provider_items_sync_failure_check" CHECK (
		(
			"sync_state" IN ('current', 'stale')
			AND "sync_failure_count" = 0
			AND "sync_error" IS NULL
			AND "sync_error_code" IS NULL
			AND "sync_error_category" IS NULL
			AND "sync_recovery" IS NULL
		)
		OR (
			"sync_state" = 'retrying'
			AND "sync_failure_count" > 0
			AND "sync_error" IS NOT NULL
			AND "sync_error_code" IS NOT NULL
			AND "sync_error_category" IN ('authorization', 'configuration', 'invalid_response', 'not_found', 'rate_limited', 'rejected', 'temporary', 'transport', 'unknown')
			AND "sync_recovery" = 'automatic'
		)
		OR (
			"sync_state" = 'blocked'
			AND "sync_failure_count" > 0
			AND "sync_error" IS NOT NULL
			AND "sync_error_code" IS NOT NULL
			AND "sync_error_category" IN ('authorization', 'configuration', 'invalid_response', 'not_found', 'rate_limited', 'rejected', 'temporary', 'transport', 'unknown')
			AND "sync_recovery" IN ('operator', 'reconnect')
		)
	)
);
--> statement-breakpoint
ALTER TABLE "finance_provider_items" ADD CONSTRAINT "finance_provider_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "finance_accounts" ADD COLUMN "provider_item_record_id" uuid;
--> statement-breakpoint
ALTER TABLE "finance_accounts" ADD CONSTRAINT "finance_accounts_provider_item_record_id_finance_provider_items_id_fk" FOREIGN KEY ("provider_item_record_id") REFERENCES "public"."finance_provider_items"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "finance_provider_items_user_idx" ON "finance_provider_items" USING btree ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_provider_items_remote_identity_idx" ON "finance_provider_items" USING btree ("user_id", "provider", "provider_item_id") WHERE "provider_item_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_provider_items_legacy_identity_idx" ON "finance_provider_items" USING btree ("user_id", "provider", "legacy_grouping_key") WHERE "legacy_grouping_key" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "finance_provider_items_sync_due_idx" ON "finance_provider_items" USING btree ("next_sync_at", "updated_at") WHERE "next_sync_at" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "finance_provider_items_sync_claim_recovery_idx" ON "finance_provider_items" USING btree ("sync_claim_expires_at") WHERE "sync_claim_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "finance_accounts_provider_item_record_id_idx" ON "finance_accounts" USING btree ("provider_item_record_id");
