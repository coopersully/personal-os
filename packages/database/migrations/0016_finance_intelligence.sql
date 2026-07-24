-- This migration intentionally squashes the branch-only 0016–0020 finance
-- migrations. It is the final schema for this feature branch and must not be
-- rewritten after it reaches a shared branch or a deployed database.

CREATE TABLE "finance_categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "group" text NOT NULL,
  "color" text,
  "is_system" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "finance_categories_user_idx" ON "finance_categories" USING btree ("user_id");
CREATE UNIQUE INDEX "finance_categories_user_slug_idx" ON "finance_categories" USING btree ("user_id", "slug");

CREATE TABLE "finance_merchants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "display_name" text NOT NULL,
  "normalized_name" text NOT NULL,
  "is_user_confirmed" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "finance_merchants_user_idx" ON "finance_merchants" USING btree ("user_id");
CREATE UNIQUE INDEX "finance_merchants_user_normalized_idx" ON "finance_merchants" USING btree ("user_id", "normalized_name");

CREATE TABLE "finance_merchant_aliases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "merchant_id" uuid NOT NULL REFERENCES "finance_merchants"("id") ON DELETE cascade,
  "raw_name" text NOT NULL,
  "normalized_name" text NOT NULL,
  "confidence_basis_points" integer DEFAULT 10000 NOT NULL,
  "source" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "finance_merchant_aliases_merchant_idx" ON "finance_merchant_aliases" USING btree ("merchant_id");
CREATE UNIQUE INDEX "finance_merchant_aliases_user_normalized_idx" ON "finance_merchant_aliases" USING btree ("user_id", "normalized_name");

ALTER TABLE "finance_accounts" ADD COLUMN "kind" text NOT NULL DEFAULT 'cash';
ALTER TABLE "finance_transactions" ADD COLUMN "merchant_id" uuid REFERENCES "finance_merchants"("id") ON DELETE set null;
ALTER TABLE "finance_transactions" ADD COLUMN "category_id" uuid REFERENCES "finance_categories"("id") ON DELETE set null;
ALTER TABLE "finance_transactions" ADD COLUMN "category_source" text;
ALTER TABLE "finance_transactions" ADD COLUMN "category_rationale" text;
ALTER TABLE "finance_transactions" ADD COLUMN "category_decided_at" timestamp with time zone;
ALTER TABLE "finance_transactions" ADD COLUMN "pending" boolean DEFAULT false NOT NULL;
ALTER TABLE "finance_transactions" ADD COLUMN "pending_transaction_id" text;
ALTER TABLE "finance_transactions" ADD COLUMN "provider_category" text;
ALTER TABLE "finance_transactions" ADD COLUMN "provider_category_detailed" text;
ALTER TABLE "finance_transactions" ADD COLUMN "provider_category_confidence" text;
ALTER TABLE "finance_transactions" ADD COLUMN "reconciliation_status" text NOT NULL DEFAULT 'not_applicable';
ALTER TABLE "finance_transactions" ADD COLUMN "transfer_group_id" uuid;
CREATE INDEX "finance_transactions_merchant_idx" ON "finance_transactions" USING btree ("user_id", "merchant_id");
CREATE INDEX "finance_transactions_reconciliation_idx" ON "finance_transactions" USING btree ("user_id", "reconciliation_status");

CREATE TABLE "finance_classification_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "transaction_id" uuid NOT NULL REFERENCES "finance_transactions"("id") ON DELETE cascade,
  "merchant_id" uuid REFERENCES "finance_merchants"("id") ON DELETE set null,
  "category_id" uuid REFERENCES "finance_categories"("id") ON DELETE set null,
  "category_name" text NOT NULL,
  "source" text NOT NULL,
  "confidence_basis_points" integer NOT NULL,
  "rationale" text,
  "outcome" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "finance_classification_decisions_transaction_idx" ON "finance_classification_decisions" USING btree ("transaction_id");
CREATE INDEX "finance_classification_decisions_merchant_idx" ON "finance_classification_decisions" USING btree ("user_id", "merchant_id");

CREATE TABLE "finance_review_cases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "transaction_id" uuid NOT NULL REFERENCES "finance_transactions"("id") ON DELETE cascade,
  "status" text DEFAULT 'open' NOT NULL,
  "reason" text NOT NULL,
  "suggested_category_id" uuid REFERENCES "finance_categories"("id") ON DELETE set null,
  "rationale" text,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "finance_review_cases_user_status_idx" ON "finance_review_cases" USING btree ("user_id", "status");
CREATE UNIQUE INDEX "finance_review_cases_open_transaction_idx" ON "finance_review_cases" USING btree ("transaction_id", "status");

-- Earlier writes used percentage points even though the stored field is basis
-- points. Preserve every already-valid value and convert only legacy 0–100 rows.
UPDATE "finance_transactions"
SET "category_confidence_basis_points" = "category_confidence_basis_points" * 100
WHERE "category_confidence_basis_points" BETWEEN 0 AND 100;

-- Earlier imports manufactured a 95% provider confidence value. Preserve their
-- category but mark the provider confidence unavailable rather than implying
-- precision we cannot prove.
UPDATE "finance_transactions"
SET
  "provider_category" = "category",
  "provider_category_confidence" = 'UNKNOWN',
  "category_confidence_basis_points" = NULL,
  "category_source" = 'provider',
  "category_rationale" = COALESCE("category_rationale", 'Imported before provider confidence was retained.')
WHERE "category_source" IS NULL
  AND "category_confidence_basis_points" = 9500
  AND "category" IS NOT NULL;

UPDATE "finance_transactions"
SET "reconciliation_status" = 'matched'
WHERE "category_rationale" = 'Matched as movement between accounts, not new spending.';

-- Generic provider transfers are candidates, not proof: keep them visible in
-- the ledger and create a durable review case until a counterpart is confirmed.
UPDATE "finance_transactions"
SET
  "reconciliation_status" = 'candidate',
  "needs_review" = true,
  "category_rationale" = 'Provider marked this as a transfer; an internal counterpart has not been confirmed yet.'
WHERE "direction" = 'transfer'
  AND "transfer_group_id" IS NULL
  AND "reconciliation_status" <> 'matched'
  AND "merchant" !~* '\\b(?:to|from|2x)\\b.*\\bvault\\b';

INSERT INTO "finance_review_cases" ("id", "user_id", "transaction_id", "status", "reason", "rationale")
SELECT gen_random_uuid(), "user_id", "id", 'open', 'possible_transfer',
  'Provider marked this as a transfer; confirm its counterpart before excluding it from spending.'
FROM "finance_transactions"
WHERE "reconciliation_status" = 'candidate'
ON CONFLICT ("transaction_id", "status") DO NOTHING;

CREATE TABLE "finance_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "employer" text,
  "role" text,
  "employment_type" text,
  "gross_annual_income_cents" integer,
  "expected_net_pay_cents" integer,
  "pay_frequency" text,
  "next_payday" text,
  "pay_account_id" uuid REFERENCES "finance_accounts"("id") ON DELETE set null,
  "effective_date" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "finance_profiles_user_effective_idx" ON "finance_profiles" USING btree ("user_id", "effective_date");
CREATE UNIQUE INDEX "finance_profiles_user_effective_idx_unique" ON "finance_profiles" USING btree ("user_id", "effective_date");

CREATE TABLE "finance_income_streams" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "account_id" uuid REFERENCES "finance_accounts"("id") ON DELETE set null,
  "payer" text NOT NULL,
  "display_name" text NOT NULL,
  "cadence" text NOT NULL,
  "expected_amount_cents" integer NOT NULL,
  "amount_tolerance_cents" integer NOT NULL,
  "next_expected_date" text,
  "last_observed_date" text,
  "confidence_basis_points" integer NOT NULL,
  "source" text NOT NULL,
  "status" text DEFAULT 'needs_review' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "finance_income_streams_user_status_idx" ON "finance_income_streams" USING btree ("user_id", "status");
CREATE UNIQUE INDEX "finance_income_streams_user_payer_idx" ON "finance_income_streams" USING btree ("user_id", "payer");

CREATE TABLE "finance_recurring_obligations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "account_id" uuid REFERENCES "finance_accounts"("id") ON DELETE set null,
  "merchant_id" uuid REFERENCES "finance_merchants"("id") ON DELETE set null,
  "merchant" text NOT NULL,
  "display_name" text NOT NULL,
  "kind" text NOT NULL,
  "cadence" text NOT NULL,
  "expected_amount_cents" integer NOT NULL,
  "amount_tolerance_cents" integer NOT NULL,
  "next_expected_date" text,
  "last_observed_date" text,
  "confidence_basis_points" integer NOT NULL,
  "source" text NOT NULL,
  "status" text DEFAULT 'needs_review' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "finance_recurring_user_status_idx" ON "finance_recurring_obligations" USING btree ("user_id", "status");
CREATE UNIQUE INDEX "finance_recurring_user_merchant_idx" ON "finance_recurring_obligations" USING btree ("user_id", "merchant");

CREATE TABLE "finance_alerts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "income_stream_id" uuid REFERENCES "finance_income_streams"("id") ON DELETE cascade,
  "recurring_obligation_id" uuid REFERENCES "finance_recurring_obligations"("id") ON DELETE cascade,
  "transaction_id" uuid REFERENCES "finance_transactions"("id") ON DELETE set null,
  "type" text NOT NULL,
  "severity" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "finance_alerts_user_status_idx" ON "finance_alerts" USING btree ("user_id", "status", "created_at");
CREATE UNIQUE INDEX "finance_alerts_open_fingerprint_idx" ON "finance_alerts" USING btree ("user_id", "type", "income_stream_id", "recurring_obligation_id", "status");
