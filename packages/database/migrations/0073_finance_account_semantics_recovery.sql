-- Migration 0072_finance_account_semantics was published before 0072_texting
-- reached main. Existing environments that already applied 0072_texting use
-- Drizzle's latest timestamp as their migration cursor and would otherwise skip
-- the earlier Finance migration. Keep both published migrations immutable and
-- make the Finance transition idempotently available after that cursor.
ALTER TABLE "finance_accounts" ADD COLUMN IF NOT EXISTS "kind_source" text DEFAULT 'default' NOT NULL;
ALTER TABLE "finance_accounts" ADD COLUMN IF NOT EXISTS "provider_type" text;
ALTER TABLE "finance_accounts" ADD COLUMN IF NOT EXISTS "provider_subtype" text;
ALTER TABLE "finance_accounts" ADD COLUMN IF NOT EXISTS "include_in_planning" boolean DEFAULT true NOT NULL;
ALTER TABLE "finance_accounts" ADD COLUMN IF NOT EXISTS "ownership_type" text DEFAULT 'unknown' NOT NULL;
ALTER TABLE "finance_accounts" ADD COLUMN IF NOT EXISTS "ownership_share_bps" integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'finance_accounts_kind_source_check'
  ) THEN
    ALTER TABLE "finance_accounts" ADD CONSTRAINT "finance_accounts_kind_source_check"
      CHECK ("kind_source" IN ('provider', 'user', 'default'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'finance_accounts_provider_type_check'
  ) THEN
    ALTER TABLE "finance_accounts" ADD CONSTRAINT "finance_accounts_provider_type_check"
      CHECK ("provider_type" IS NULL OR "provider_type" IN ('depository', 'investment', 'brokerage', 'credit', 'loan', 'other'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'finance_accounts_ownership_check'
  ) THEN
    ALTER TABLE "finance_accounts" ADD CONSTRAINT "finance_accounts_ownership_check" CHECK (
      ("ownership_type" = 'individual' AND "ownership_share_bps" = 10000)
      OR ("ownership_type" = 'joint' AND "ownership_share_bps" BETWEEN 1 AND 10000)
      OR ("ownership_type" = 'unknown' AND "ownership_share_bps" IS NULL)
    );
  END IF;
END $$;
