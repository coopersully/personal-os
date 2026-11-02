-- Additive provider evidence only. Existing ledgers are not merged or removed.
ALTER TABLE "finance_accounts" ADD COLUMN "provider_institution_id" text;
--> statement-breakpoint
ALTER TABLE "finance_accounts" ADD COLUMN "provider_account_mask" text;
--> statement-breakpoint
ALTER TABLE "finance_accounts" ADD COLUMN "provider_persistent_account_id" text;
--> statement-breakpoint
ALTER TABLE "finance_accounts" ADD COLUMN "provider_account_name" text;
