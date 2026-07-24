CREATE TABLE "finance_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "provider" text NOT NULL,
  "institution" text NOT NULL,
  "name" text NOT NULL,
  "balance_cents" integer,
  "status" text DEFAULT 'manual' NOT NULL,
  "encrypted_credentials" jsonb,
  "last_synced_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "finance_transactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "account_id" uuid NOT NULL REFERENCES "finance_accounts"("id") ON DELETE cascade,
  "provider_transaction_id" text,
  "merchant" text NOT NULL,
  "amount_cents" integer NOT NULL,
  "direction" text NOT NULL,
  "transaction_date" text NOT NULL,
  "category" text,
  "category_confidence_basis_points" integer,
  "needs_review" boolean DEFAULT true NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "finance_budgets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "category" text NOT NULL,
  "month" text NOT NULL,
  "limit_cents" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "finance_accounts_user_idx" ON "finance_accounts" USING btree ("user_id");
CREATE INDEX "finance_transactions_user_date_idx" ON "finance_transactions" USING btree ("user_id", "transaction_date");
CREATE INDEX "finance_transactions_review_idx" ON "finance_transactions" USING btree ("user_id", "needs_review");
CREATE UNIQUE INDEX "finance_transactions_provider_idx" ON "finance_transactions" USING btree ("account_id", "provider_transaction_id");
CREATE UNIQUE INDEX "finance_budgets_user_category_month_idx" ON "finance_budgets" USING btree ("user_id", "category", "month");
