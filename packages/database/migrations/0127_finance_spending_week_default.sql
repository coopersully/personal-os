-- Only future defaults change; preserve every existing saved period and grouping.
ALTER TABLE finances_workspace_settings ALTER COLUMN finance_spending_period SET DEFAULT 'week';
