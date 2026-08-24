ALTER TABLE "finance_transactions"
	ADD COLUMN "provider_direction" text;
--> statement-breakpoint
ALTER TABLE "finance_transactions"
	ADD CONSTRAINT "finance_transactions_provider_direction_check"
	CHECK ("provider_direction" IS NULL OR "provider_direction" IN ('expense', 'income'));
