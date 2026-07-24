CREATE TABLE "finance_category_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "merchant_normalized" text NOT NULL,
  "category" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "finance_category_rules_user_idx" ON "finance_category_rules" USING btree ("user_id");
CREATE UNIQUE INDEX "finance_category_rules_merchant_idx" ON "finance_category_rules" USING btree ("user_id", "merchant_normalized");
