ALTER TABLE "finances_workspace_settings"
  ADD COLUMN "spend_account_ids" uuid[],
  ADD COLUMN "cash_account_ids" uuid[],
  ADD COLUMN "investment_account_ids" uuid[];
