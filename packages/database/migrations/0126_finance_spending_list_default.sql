-- Change only future defaults; existing saved view choices stay unchanged.
ALTER TABLE finances_workspace_settings ALTER COLUMN finance_spending_view SET DEFAULT 'list';
