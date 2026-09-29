CREATE TABLE "finance_agent_settings" (
  "user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "review_bypass_enabled" boolean DEFAULT false NOT NULL,
  "version" integer DEFAULT 1 NOT NULL CHECK ("version" > 0),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "finance_profile_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "version" integer NOT NULL CHECK ("version" > 0),
  "jurisdiction" text,
  "household_size" integer CHECK ("household_size" > 0),
  "dependents" integer CHECK ("dependents" >= 0),
  "expected_monthly_take_home_cents" integer CHECK ("expected_monthly_take_home_cents" >= 0),
  "income_stability" text DEFAULT 'unknown' NOT NULL,
  "liquid_reserves_cents" integer CHECK ("liquid_reserves_cents" >= 0),
  "debts" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "insurance" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "preferences" jsonb DEFAULT '{"notes":[]}'::jsonb NOT NULL,
  "employment" jsonb,
  "provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "source_legacy_profile_id" uuid REFERENCES "finance_profiles"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "finance_profile_versions_income_stability_check"
    CHECK ("income_stability" IN ('seasonal', 'stable', 'unknown', 'variable'))
);

ALTER TABLE "finance_budget_plans"
  ADD COLUMN "name" text DEFAULT 'Monthly plan' NOT NULL,
  ADD COLUMN "status" text DEFAULT 'active' NOT NULL,
  ALTER COLUMN "month" SET DEFAULT ('canonical-' || gen_random_uuid()::text),
  ALTER COLUMN "rationale" SET DEFAULT '';

ALTER TABLE "finance_budget_plans"
  ADD CONSTRAINT "finance_budget_plans_status_check"
  CHECK ("status" IN ('active', 'archived'));

CREATE TABLE "finance_goals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "target_amount_cents" integer NOT NULL CHECK ("target_amount_cents" >= 0),
  "current_amount_cents" integer DEFAULT 0 NOT NULL CHECK ("current_amount_cents" >= 0),
  "deadline" text,
  "priority" text DEFAULT 'medium' NOT NULL CHECK ("priority" IN ('high', 'low', 'medium')),
  "status" text DEFAULT 'active' NOT NULL CHECK ("status" IN ('active', 'completed', 'paused', 'removed')),
  "version" integer DEFAULT 1 NOT NULL CHECK ("version" > 0),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "finance_budget_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "plan_id" uuid NOT NULL REFERENCES "finance_budget_plans"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "version" integer NOT NULL CHECK ("version" > 0),
  "status" text DEFAULT 'incomplete' NOT NULL CHECK ("status" IN ('active', 'incomplete', 'proposed', 'retired')),
  "effective_from" text NOT NULL CHECK ("effective_from" ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  "expected_resources_cents" integer NOT NULL CHECK ("expected_resources_cents" >= 0),
  "allocated_total_cents" integer NOT NULL CHECK ("allocated_total_cents" >= 0),
  "balance_delta_cents" integer NOT NULL,
  "resources" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "assumptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "rationale" text NOT NULL,
  "created_by_actor_type" text,
  "created_by_actor_id" text,
  "approved_by_actor_type" text,
  "approved_by_actor_id" text,
  "approved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "finance_budget_versions_balance_check" CHECK (
    "status" = 'incomplete' OR (
      "balance_delta_cents" = 0 AND
      "expected_resources_cents" = "allocated_total_cents"
    )
  )
);

CREATE TABLE "finance_budget_allocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "budget_version_id" uuid NOT NULL REFERENCES "finance_budget_versions"("id") ON DELETE cascade,
  "allocation_key" text NOT NULL,
  "kind" text NOT NULL CHECK ("kind" IN ('buffer', 'debt', 'goal', 'savings', 'spending')),
  "amount_cents" integer NOT NULL CHECK ("amount_cents" >= 0),
  "description" text,
  "category_id" uuid REFERENCES "finance_categories"("id") ON DELETE set null,
  "account_id" uuid REFERENCES "finance_accounts"("id") ON DELETE set null,
  "goal_id" uuid REFERENCES "finance_goals"("id") ON DELETE set null,
  "legacy_category" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "finance_setup_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "status" text DEFAULT 'collecting_profile' NOT NULL CHECK (
    "status" IN ('budget_approval', 'budget_proposal', 'collecting_profile', 'initial_maintenance', 'settled')
  ),
  "current_question_key" text,
  "budget_version_id" uuid REFERENCES "finance_budget_versions"("id") ON DELETE set null,
  "maintenance_run_id" uuid,
  "version" integer DEFAULT 1 NOT NULL CHECK ("version" > 0),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "finance_profile_versions_user_version_idx"
  ON "finance_profile_versions" ("user_id", "version");
CREATE INDEX "finance_profile_versions_user_created_idx"
  ON "finance_profile_versions" ("user_id", "created_at");
CREATE INDEX "finance_budget_plans_user_status_idx"
  ON "finance_budget_plans" ("user_id", "status");
CREATE INDEX "finance_goals_user_status_idx"
  ON "finance_goals" ("user_id", "status");
CREATE UNIQUE INDEX "finance_budget_versions_plan_version_idx"
  ON "finance_budget_versions" ("plan_id", "version");
CREATE INDEX "finance_budget_versions_user_status_idx"
  ON "finance_budget_versions" ("user_id", "status", "effective_from");
CREATE UNIQUE INDEX "finance_budget_versions_user_active_month_idx"
  ON "finance_budget_versions" ("user_id", "effective_from") WHERE "status" = 'active';
CREATE UNIQUE INDEX "finance_budget_allocations_version_key_idx"
  ON "finance_budget_allocations" ("budget_version_id", "allocation_key");
CREATE INDEX "finance_budget_allocations_user_idx"
  ON "finance_budget_allocations" ("user_id");
CREATE INDEX "finance_setup_sessions_user_status_idx"
  ON "finance_setup_sessions" ("user_id", "status");
CREATE UNIQUE INDEX "finance_setup_sessions_user_active_idx"
  ON "finance_setup_sessions" ("user_id") WHERE "status" <> 'settled';

-- Preserve legacy employment profiles exactly and derive monthly take-home only when cadence is known.
INSERT INTO "finance_profile_versions" (
  "user_id",
  "version",
  "expected_monthly_take_home_cents",
  "income_stability",
  "employment",
  "provenance",
  "source_legacy_profile_id",
  "created_at",
  "updated_at"
)
SELECT
  "user_id",
  row_number() OVER (PARTITION BY "user_id" ORDER BY "effective_date", "created_at", "id"),
  CASE "pay_frequency"
    WHEN 'weekly' THEN round("expected_net_pay_cents" * 52.0 / 12.0)::integer
    WHEN 'biweekly' THEN round("expected_net_pay_cents" * 26.0 / 12.0)::integer
    WHEN 'semimonthly' THEN "expected_net_pay_cents" * 2
    WHEN 'monthly' THEN "expected_net_pay_cents"
    ELSE NULL
  END,
  CASE WHEN "pay_frequency" = 'irregular' THEN 'variable' ELSE 'unknown' END,
  jsonb_build_object(
    'employer', "employer",
    'role', "role",
    'employmentType', "employment_type",
    'grossAnnualIncomeCents', "gross_annual_income_cents",
    'expectedNetPayCents', "expected_net_pay_cents",
    'payFrequency', "pay_frequency",
    'nextPayday', "next_payday",
    'payAccountId', "pay_account_id",
    'effectiveDate', "effective_date"
  ),
  jsonb_build_object(
    'migration', jsonb_build_object(
      'source', 'finance_profiles',
      'expectedMonthlyTakeHome', 'derived_from_expected_net_pay_and_pay_frequency'
    )
  ),
  "id",
  "created_at",
  "updated_at"
FROM "finance_profiles";

-- Legacy category limits lack resource data, so migrate them as visibly incomplete plans.
INSERT INTO "finance_budget_plans" ("user_id", "month", "name", "created_at", "updated_at")
SELECT "user_id", 'canonical', 'Legacy monthly budget', min("created_at"), max("updated_at")
FROM "finance_budgets"
GROUP BY "user_id"
ON CONFLICT ("user_id", "month") DO NOTHING;

INSERT INTO "finance_budget_versions" (
  "plan_id",
  "user_id",
  "version",
  "status",
  "effective_from",
  "expected_resources_cents",
  "allocated_total_cents",
  "balance_delta_cents",
  "resources",
  "assumptions",
  "rationale",
  "created_at",
  "updated_at"
)
SELECT
  p."id",
  b."user_id",
  row_number() OVER (PARTITION BY b."user_id" ORDER BY b."month"),
  'incomplete',
  b."month",
  0,
  sum(b."limit_cents")::integer,
  -sum(b."limit_cents")::integer,
  '[]'::jsonb,
  '["Migrated from category limits; expected resources must be supplied before approval."]'::jsonb,
  'Preserved from the legacy category budget. This version is incomplete and cannot be approved.',
  min(b."created_at"),
  max(b."updated_at")
FROM "finance_budgets" b
JOIN "finance_budget_plans" p ON p."user_id" = b."user_id" AND p."name" = 'Legacy monthly budget'
GROUP BY p."id", b."user_id", b."month";

INSERT INTO "finance_budget_allocations" (
  "user_id",
  "budget_version_id",
  "allocation_key",
  "kind",
  "amount_cents",
  "description",
  "legacy_category",
  "created_at",
  "updated_at"
)
SELECT
  b."user_id",
  v."id",
  'legacy-' || b."id"::text,
  'spending',
  b."limit_cents",
  b."category",
  b."category",
  b."created_at",
  b."updated_at"
FROM "finance_budgets" b
JOIN "finance_budget_versions" v
  ON v."user_id" = b."user_id"
  AND v."effective_from" = b."month"
  AND v."status" = 'incomplete';
