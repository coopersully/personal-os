-- Nullable expansion: old approvals remain historical facts, not current-input evidence.
ALTER TABLE "finance_budget_versions" ADD COLUMN "input_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "finance_budget_versions" ADD COLUMN "resources_confirmed_by" uuid;
--> statement-breakpoint
ALTER TABLE "finance_budget_versions" ADD CONSTRAINT "finance_budget_resources_owner_check" CHECK ("resources_confirmed_by" IS NULL OR "resources_confirmed_by" = "user_id");
