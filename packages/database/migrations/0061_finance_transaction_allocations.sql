ALTER TABLE "finance_merchants" ADD COLUMN "behavior" text DEFAULT 'unknown' NOT NULL;
--> statement-breakpoint
ALTER TABLE "finance_merchants" ADD CONSTRAINT "finance_merchants_behavior_check" CHECK ("behavior" IN ('unknown', 'consistent', 'mixed'));
--> statement-breakpoint
ALTER TABLE "finance_setup_backfill_state" ADD COLUMN "allocation_cursor" uuid;
--> statement-breakpoint
ALTER TABLE "finance_setup_backfill_state" ADD COLUMN "allocations_complete" boolean DEFAULT false NOT NULL;
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
	"state" text DEFAULT 'active' NOT NULL,
	"invalidated_at" timestamptz,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "finance_transaction_allocations_amount_check" CHECK ("amount_cents" > 0),
	CONSTRAINT "finance_transaction_allocations_order_check" CHECK ("allocation_order" >= 0),
	CONSTRAINT "finance_transaction_allocations_treatment_check" CHECK ("treatment" IN ('personal', 'reimbursable')),
	CONSTRAINT "finance_transaction_allocations_state_check" CHECK ("state" IN ('active', 'invalidated'))
);
--> statement-breakpoint
ALTER TABLE "finance_transaction_allocations" ADD CONSTRAINT "finance_transaction_allocations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "finance_transaction_allocations" ADD CONSTRAINT "finance_transaction_allocations_transaction_id_finance_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."finance_transactions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "finance_transaction_allocations" ADD CONSTRAINT "finance_transaction_allocations_category_id_finance_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."finance_categories"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_id_user_id_unique" UNIQUE ("id", "user_id");
--> statement-breakpoint
ALTER TABLE "finance_categories" ADD CONSTRAINT "finance_categories_id_user_id_unique" UNIQUE ("id", "user_id");
--> statement-breakpoint
ALTER TABLE "finance_transaction_allocations" ADD CONSTRAINT "finance_transaction_allocations_transaction_user_fk" FOREIGN KEY ("transaction_id", "user_id") REFERENCES "public"."finance_transactions"("id", "user_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "finance_transaction_allocations" ADD CONSTRAINT "finance_transaction_allocations_category_user_fk" FOREIGN KEY ("category_id", "user_id") REFERENCES "public"."finance_categories"("id", "user_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "finance_transaction_allocations_user_category_idx" ON "finance_transaction_allocations" USING btree ("user_id", "category_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_transaction_allocations_transaction_order_idx" ON "finance_transaction_allocations" USING btree ("transaction_id", "allocation_order") WHERE "state" = 'active';
--> statement-breakpoint
ALTER TABLE "finance_category_rules" ADD COLUMN "rationale" text;
--> statement-breakpoint
ALTER TABLE "finance_category_rules" ADD COLUMN "evidence" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
