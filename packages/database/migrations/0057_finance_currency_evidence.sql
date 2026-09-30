ALTER TABLE "finance_accounts" ADD COLUMN "currency_code" text;
--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD COLUMN "currency_code" text;
--> statement-breakpoint
ALTER TABLE "finance_accounts" ADD CONSTRAINT "finance_accounts_currency_code_check" CHECK ("currency_code" IS NULL OR "currency_code" ~ '^[A-Z]{3}$');
--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_currency_code_check" CHECK ("currency_code" IS NULL OR "currency_code" ~ '^[A-Z]{3}$');
