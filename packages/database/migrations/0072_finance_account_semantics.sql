ALTER TABLE "finance_accounts" ADD COLUMN "kind_source" text DEFAULT 'default' NOT NULL;
ALTER TABLE "finance_accounts" ADD COLUMN "provider_type" text;
ALTER TABLE "finance_accounts" ADD COLUMN "provider_subtype" text;
ALTER TABLE "finance_accounts" ADD COLUMN "include_in_planning" boolean DEFAULT true NOT NULL;
ALTER TABLE "finance_accounts" ADD COLUMN "ownership_type" text DEFAULT 'unknown' NOT NULL;
ALTER TABLE "finance_accounts" ADD COLUMN "ownership_share_bps" integer;
ALTER TABLE "finance_accounts" ADD CONSTRAINT "finance_accounts_kind_source_check" CHECK ("kind_source" IN ('provider', 'user', 'default'));
ALTER TABLE "finance_accounts" ADD CONSTRAINT "finance_accounts_provider_type_check" CHECK ("provider_type" IS NULL OR "provider_type" IN ('depository', 'investment', 'brokerage', 'credit', 'loan', 'other'));
ALTER TABLE "finance_accounts" ADD CONSTRAINT "finance_accounts_ownership_check" CHECK (
  ("ownership_type" = 'individual' AND "ownership_share_bps" = 10000)
  OR ("ownership_type" = 'joint' AND "ownership_share_bps" BETWEEN 1 AND 10000)
  OR ("ownership_type" = 'unknown' AND "ownership_share_bps" IS NULL)
);
