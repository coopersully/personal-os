WITH legacy_months AS (
  SELECT
    p."id" AS "plan_id",
    b."user_id",
    b."month" AS "legacy_month",
    row_number() OVER (PARTITION BY b."user_id" ORDER BY b."month") AS "version",
    CASE
      WHEN b."month" ~ '^\d{4}-(0[1-9]|1[0-2])$' THEN b."month"
      ELSE to_char(min(b."created_at") AT TIME ZONE 'UTC', 'YYYY-MM')
    END AS "effective_from",
    sum(b."limit_cents")::integer AS "allocated_total_cents",
    min(b."created_at") AS "created_at",
    max(b."updated_at") AS "updated_at"
  FROM "finance_budgets" b
  JOIN "finance_budget_plans" p
    ON p."user_id" = b."user_id" AND p."month" = 'canonical'
  GROUP BY p."id", b."user_id", b."month"
)
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
  "plan_id",
  "user_id",
  "version",
  'incomplete',
  "effective_from",
  0,
  "allocated_total_cents",
  -"allocated_total_cents",
  '[]'::jsonb,
  '["Migrated from category limits; expected resources must be supplied before approval."]'::jsonb,
  'Preserved from the legacy category budget. This version is incomplete and cannot be approved.',
  "created_at",
  "updated_at"
FROM legacy_months
ON CONFLICT ("plan_id", "version") DO NOTHING;

WITH legacy_months AS (
  SELECT
    p."id" AS "plan_id",
    b."user_id",
    b."month" AS "legacy_month",
    row_number() OVER (PARTITION BY b."user_id" ORDER BY b."month") AS "version"
  FROM "finance_budgets" b
  JOIN "finance_budget_plans" p
    ON p."user_id" = b."user_id" AND p."month" = 'canonical'
  GROUP BY p."id", b."user_id", b."month"
), target_versions AS (
  SELECT legacy_months.*, versions."id" AS "budget_version_id"
  FROM legacy_months
  JOIN "finance_budget_versions" versions
    ON versions."plan_id" = legacy_months."plan_id"
    AND versions."version" = legacy_months."version"
    AND versions."status" = 'incomplete'
)
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
  budgets."user_id",
  target_versions."budget_version_id",
  'legacy-' || budgets."id"::text,
  'spending',
  budgets."limit_cents",
  budgets."category",
  budgets."category",
  budgets."created_at",
  budgets."updated_at"
FROM "finance_budgets" budgets
JOIN target_versions
  ON target_versions."user_id" = budgets."user_id"
  AND target_versions."legacy_month" = budgets."month"
ON CONFLICT ("budget_version_id", "allocation_key") DO NOTHING;
