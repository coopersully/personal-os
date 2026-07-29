INSERT INTO "finance_categories" (
	"user_id",
	"name",
	"slug",
	"group",
	"is_system"
)
SELECT
	owners."user_id",
	defaults."name",
	defaults."slug",
	defaults."group",
	true
FROM (
	SELECT DISTINCT "user_id"
	FROM "finance_accounts"
) AS owners
CROSS JOIN (
	VALUES
		('Auto & Transport', 'transport', 'Spending'),
		('Bills & Utilities', 'bills', 'Essential'),
		('Cash & ATM', 'cash', 'Spending'),
		('Dining', 'dining', 'Spending'),
		('Education', 'education', 'Spending'),
		('Entertainment', 'entertainment', 'Spending'),
		('Fees', 'fees', 'Spending'),
		('Gifts & Donations', 'gifts', 'Spending'),
		('Groceries', 'groceries', 'Spending'),
		('Health', 'health', 'Spending'),
		('Housing', 'housing', 'Essential'),
		('Income', 'income', 'Financial'),
		('Insurance', 'insurance', 'Essential'),
		('Investments', 'investments', 'Financial'),
		('Personal Care', 'personal-care', 'Spending'),
		('Shopping', 'shopping', 'Spending'),
		('Subscriptions', 'subscriptions', 'Spending'),
		('Taxes', 'taxes', 'Essential'),
		('Transfers', 'transfers', 'Financial'),
		('Travel', 'travel', 'Spending')
) AS defaults("name", "slug", "group")
ON CONFLICT ("user_id", "slug") DO NOTHING;
