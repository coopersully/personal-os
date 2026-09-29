CREATE TABLE "finance_budget_taxonomies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "finance_budget_taxonomies_version_check" CHECK ("version" > 0)
);
CREATE INDEX "finance_budget_taxonomies_user_idx" ON "finance_budget_taxonomies" ("user_id");
CREATE UNIQUE INDEX "finance_budget_taxonomies_user_active_idx" ON "finance_budget_taxonomies" ("user_id") WHERE "is_active" = true;

CREATE TABLE "finance_budget_buckets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "taxonomy_id" uuid NOT NULL REFERENCES "finance_budget_taxonomies"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text,
  "position" integer DEFAULT 0 NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "finance_budget_buckets_position_check" CHECK ("position" >= 0),
  CONSTRAINT "finance_budget_buckets_version_check" CHECK ("version" > 0)
);
CREATE INDEX "finance_budget_buckets_user_idx" ON "finance_budget_buckets" ("user_id", "taxonomy_id");
CREATE UNIQUE INDEX "finance_budget_buckets_taxonomy_name_idx" ON "finance_budget_buckets" ("taxonomy_id", "name");

CREATE TABLE "finance_budget_bucket_categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "taxonomy_id" uuid NOT NULL REFERENCES "finance_budget_taxonomies"("id") ON DELETE CASCADE,
  "bucket_id" uuid NOT NULL REFERENCES "finance_budget_buckets"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "category_id" uuid NOT NULL REFERENCES "finance_categories"("id") ON DELETE RESTRICT,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "finance_budget_bucket_categories_taxonomy_category_idx" ON "finance_budget_bucket_categories" ("taxonomy_id", "category_id");
CREATE UNIQUE INDEX "finance_budget_bucket_categories_bucket_category_idx" ON "finance_budget_bucket_categories" ("bucket_id", "category_id");
CREATE INDEX "finance_budget_bucket_categories_bucket_idx" ON "finance_budget_bucket_categories" ("bucket_id");

ALTER TABLE "finance_budgets" ADD COLUMN "bucket_id" uuid REFERENCES "finance_budget_buckets"("id") ON DELETE SET NULL;
