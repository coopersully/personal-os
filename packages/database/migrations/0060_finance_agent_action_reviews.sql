CREATE TABLE "finance_agent_action_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"requesting_agent_id" text NOT NULL,
	"source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"action_kind" text NOT NULL,
	"private_payload" jsonb NOT NULL,
	"safe_changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"maintenance_run_id" uuid,
	"expected_revision" text,
	"fingerprint" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finance_agent_action_reviews" ADD CONSTRAINT "finance_agent_action_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "finance_agent_action_reviews" ADD CONSTRAINT "finance_agent_action_reviews_maintenance_run_id_workspace_maintenance_runs_id_fk" FOREIGN KEY ("maintenance_run_id") REFERENCES "public"."workspace_maintenance_runs"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "finance_profiles" ADD COLUMN "household_size" integer;
--> statement-breakpoint
ALTER TABLE "finance_profiles" ADD COLUMN "dependents" integer;
--> statement-breakpoint
ALTER TABLE "finance_profiles" ADD COLUMN "housing_status" text;
--> statement-breakpoint
ALTER TABLE "finance_profiles" ADD COLUMN "monthly_housing_cost_cents" integer;
--> statement-breakpoint
ALTER TABLE "finance_profiles" ADD COLUMN "reserve_target_months" integer;
--> statement-breakpoint
ALTER TABLE "finance_profiles" ADD COLUMN "investment_risk_willingness" text;
--> statement-breakpoint
ALTER TABLE "finance_profiles" ADD COLUMN "investment_risk_capacity" text;
--> statement-breakpoint
CREATE INDEX "finance_agent_action_reviews_user_status_idx" ON "finance_agent_action_reviews" USING btree ("user_id", "status", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_agent_action_reviews_pending_fingerprint_idx" ON "finance_agent_action_reviews" USING btree ("user_id", "fingerprint") WHERE "status" = 'pending';
--> statement-breakpoint
CREATE TABLE "finance_budget_plans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "month" text NOT NULL,
  "goal_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "assumptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "rationale" text NOT NULL,
  "replace_existing" boolean DEFAULT true NOT NULL,
  "scenario_fingerprint" text,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "finance_budget_plans_user_month_idx" UNIQUE("user_id", "month")
);
--> statement-breakpoint
ALTER TABLE "finance_budget_plans" ADD CONSTRAINT "finance_budget_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
