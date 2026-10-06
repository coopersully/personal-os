ALTER TABLE "finances_workspace_settings"
  ADD COLUMN "finance_transaction_view" text DEFAULT 'table' NOT NULL,
  ADD COLUMN "finance_transaction_group" text DEFAULT 'none' NOT NULL,
  ADD CONSTRAINT "finances_transaction_view_check" CHECK ("finance_transaction_view" IN ('table', 'cards')),
  ADD CONSTRAINT "finances_transaction_group_check" CHECK ("finance_transaction_group" IN ('none', 'date', 'category', 'merchant', 'direction', 'posting'));
