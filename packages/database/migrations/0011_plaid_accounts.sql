ALTER TABLE "finance_accounts" ADD COLUMN "provider_account_id" text;
ALTER TABLE "finance_accounts" ADD COLUMN "provider_item_id" text;
ALTER TABLE "finance_accounts" ADD COLUMN "sync_cursor" text;
CREATE UNIQUE INDEX "finance_accounts_provider_idx" ON "finance_accounts" USING btree ("user_id", "provider", "provider_account_id");
