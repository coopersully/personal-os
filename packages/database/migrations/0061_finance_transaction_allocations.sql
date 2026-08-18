ALTER TABLE "finance_merchants" ADD COLUMN "behavior" text DEFAULT 'unknown' NOT NULL;
--> statement-breakpoint
ALTER TABLE "finance_merchants" ADD CONSTRAINT "finance_merchants_behavior_check" CHECK ("behavior" IN ('unknown', 'consistent', 'mixed'));
--> statement-breakpoint
CREATE TABLE "finance_transaction_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"allocation_order" integer NOT NULL,
	"treatment" text DEFAULT 'personal' NOT NULL,
	"rationale" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "finance_transaction_allocations_amount_check" CHECK ("amount_cents" > 0),
	CONSTRAINT "finance_transaction_allocations_order_check" CHECK ("allocation_order" >= 0),
	CONSTRAINT "finance_transaction_allocations_treatment_check" CHECK ("treatment" IN ('personal', 'reimbursable'))
);
--> statement-breakpoint
ALTER TABLE "finance_transaction_allocations" ADD CONSTRAINT "finance_transaction_allocations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "finance_transaction_allocations" ADD CONSTRAINT "finance_transaction_allocations_transaction_id_finance_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."finance_transactions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "finance_transaction_allocations" ADD CONSTRAINT "finance_transaction_allocations_category_id_finance_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."finance_categories"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "finance_transaction_allocations_user_category_idx" ON "finance_transaction_allocations" USING btree ("user_id", "category_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_transaction_allocations_transaction_order_idx" ON "finance_transaction_allocations" USING btree ("transaction_id", "allocation_order");
--> statement-breakpoint
INSERT INTO "finance_transaction_allocations" ("user_id", "transaction_id", "category_id", "amount_cents", "allocation_order", "treatment", "rationale")
SELECT "user_id", "id", "category_id", "amount_cents", 0, 'personal', 'Backfilled from the posted transaction category.'
FROM "finance_transactions"
WHERE "pending" = false AND "category_id" IS NOT NULL
ON CONFLICT ("transaction_id", "allocation_order") DO NOTHING;
