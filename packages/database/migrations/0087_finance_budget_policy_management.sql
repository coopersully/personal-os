CREATE UNIQUE INDEX "finance_budget_plans_id_user_idx" ON "finance_budget_plans" ("id", "user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_budget_versions_id_user_idx" ON "finance_budget_versions" ("id", "user_id");
--> statement-breakpoint
CREATE TABLE "finance_budget_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "plan_id" uuid NOT NULL,
  "lifecycle_revision" integer NOT NULL,
  "state" text NOT NULL,
  "created_by_actor_id" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "disabled_at" timestamp with time zone,
  "disabled_by_actor_id" text,
  CONSTRAINT "finance_budget_policies_revision_check" CHECK (lifecycle_revision >= 1),
  CONSTRAINT "finance_budget_policies_state_check" CHECK ((state = 'draft' AND disabled_at IS NULL AND disabled_by_actor_id IS NULL) OR (state = 'disabled' AND disabled_at IS NOT NULL AND disabled_by_actor_id IS NOT NULL)),
  CONSTRAINT "finance_budget_policies_owner_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE,
  CONSTRAINT "finance_budget_policies_plan_fk" FOREIGN KEY ("plan_id", "user_id") REFERENCES "finance_budget_plans" ("id", "user_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_budget_policies_id_user_idx" ON "finance_budget_policies" ("id", "user_id");
--> statement-breakpoint
CREATE INDEX "finance_budget_policies_user_updated_idx" ON "finance_budget_policies" ("user_id", "updated_at", "id");
--> statement-breakpoint
CREATE INDEX "finance_budget_policies_user_plan_state_idx" ON "finance_budget_policies" ("user_id", "plan_id", "state");
--> statement-breakpoint
CREATE TABLE "finance_budget_policy_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "policy_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "baseline_budget_version_id" uuid NOT NULL,
  "period_month" text NOT NULL,
  "period_from" text NOT NULL,
  "period_through" text NOT NULL,
  "timezone" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "per_change_cap_cents" integer NOT NULL,
  "monthly_cap_cents" integer NOT NULL,
  "currency" text NOT NULL,
  "rollover" text NOT NULL,
  "accounting" text NOT NULL,
  "usage_scope" text NOT NULL,
  "directions" jsonb NOT NULL,
  "protections" jsonb NOT NULL,
  "created_by_actor_id" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "finance_budget_policy_versions_version_check" CHECK (version >= 1),
  CONSTRAINT "finance_budget_policy_versions_period_check" CHECK (period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND period_from = period_month || '-01' AND period_through = to_char((period_from::date + interval '1 month - 1 day'), 'YYYY-MM-DD') AND char_length(timezone) BETWEEN 1 AND 100),
  CONSTRAINT "finance_budget_policy_versions_caps_check" CHECK (per_change_cap_cents >= 0 AND monthly_cap_cents >= 0),
  CONSTRAINT "finance_budget_policy_versions_terms_check" CHECK (currency = 'USD' AND rollover = 'none' AND accounting = 'gross_positive_allocation_deltas' AND usage_scope = 'user_month_all_policy_versions'),
  CONSTRAINT "finance_budget_policy_versions_directions_check" CHECK (jsonb_typeof(directions) = 'array' AND octet_length(directions::text) <= 131072),
  CONSTRAINT "finance_budget_policy_versions_protections_check" CHECK (jsonb_typeof(protections) = 'array' AND octet_length(protections::text) <= 131072),
  CONSTRAINT "finance_budget_policy_versions_entries_check" CHECK (jsonb_array_length(directions) <= 500 AND jsonb_array_length(protections) <= 500),
  CONSTRAINT "finance_budget_policy_versions_owner_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE,
  CONSTRAINT "finance_budget_policy_versions_policy_fk" FOREIGN KEY ("policy_id", "user_id") REFERENCES "finance_budget_policies" ("id", "user_id"),
  CONSTRAINT "finance_budget_policy_versions_baseline_fk" FOREIGN KEY ("baseline_budget_version_id", "user_id") REFERENCES "finance_budget_versions" ("id", "user_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_budget_policy_versions_id_user_idx" ON "finance_budget_policy_versions" ("id", "user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_budget_policy_versions_policy_owner_idx" ON "finance_budget_policy_versions" ("id", "policy_id", "user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_budget_policy_versions_policy_version_idx" ON "finance_budget_policy_versions" ("policy_id", "version");
--> statement-breakpoint
CREATE INDEX "finance_budget_policy_versions_user_policy_version_idx" ON "finance_budget_policy_versions" ("user_id", "policy_id", "version");
--> statement-breakpoint
CREATE INDEX "finance_budget_policy_versions_user_expiry_idx" ON "finance_budget_policy_versions" ("user_id", "expires_at");
--> statement-breakpoint
CREATE TABLE "finance_budget_revision_proposals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "policy_id" uuid NOT NULL,
  "policy_version_id" uuid NOT NULL,
  "plan_id" uuid NOT NULL,
  "profile_version_id" uuid,
  "baseline_budget_version_id" uuid NOT NULL,
  "active_budget_version_id" uuid,
  "latest_budget_version_id" uuid,
  "candidate_snapshot" jsonb NOT NULL,
  "candidate_hash" text NOT NULL,
  "state" text NOT NULL,
  "lifecycle_revision" integer NOT NULL,
  "created_by_actor_id" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "withdrawn_at" timestamp with time zone,
  "withdrawn_by_actor_id" text,
  CONSTRAINT "finance_budget_revision_proposals_revision_check" CHECK (lifecycle_revision >= 1),
  CONSTRAINT "finance_budget_revision_proposals_state_check" CHECK ((state = 'inactive' AND withdrawn_at IS NULL AND withdrawn_by_actor_id IS NULL) OR (state = 'withdrawn' AND withdrawn_at IS NOT NULL AND withdrawn_by_actor_id IS NOT NULL)),
  CONSTRAINT "finance_budget_revision_proposals_candidate_snapshot_check" CHECK (jsonb_typeof(candidate_snapshot) = 'object' AND octet_length(candidate_snapshot::text) <= 524288),
  CONSTRAINT "finance_budget_revision_proposals_hash_check" CHECK (candidate_hash ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "finance_budget_revision_proposals_owner_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE,
  CONSTRAINT "finance_budget_revision_proposals_policy_version_fk" FOREIGN KEY ("policy_version_id", "policy_id", "user_id") REFERENCES "finance_budget_policy_versions" ("id", "policy_id", "user_id"),
  CONSTRAINT "finance_budget_revision_proposals_plan_fk" FOREIGN KEY ("plan_id", "user_id") REFERENCES "finance_budget_plans" ("id", "user_id"),
  CONSTRAINT "finance_budget_revision_proposals_profile_fk" FOREIGN KEY ("profile_version_id", "user_id") REFERENCES "finance_profile_versions" ("id", "user_id"),
  CONSTRAINT "finance_budget_revision_proposals_baseline_fk" FOREIGN KEY ("baseline_budget_version_id", "user_id") REFERENCES "finance_budget_versions" ("id", "user_id"),
  CONSTRAINT "finance_budget_revision_proposals_active_fk" FOREIGN KEY ("active_budget_version_id", "user_id") REFERENCES "finance_budget_versions" ("id", "user_id"),
  CONSTRAINT "finance_budget_revision_proposals_latest_fk" FOREIGN KEY ("latest_budget_version_id", "user_id") REFERENCES "finance_budget_versions" ("id", "user_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_budget_revision_proposals_id_user_idx" ON "finance_budget_revision_proposals" ("id", "user_id");
--> statement-breakpoint
CREATE INDEX "finance_budget_revision_proposals_user_state_created_idx" ON "finance_budget_revision_proposals" ("user_id", "state", "created_at", "id");
--> statement-breakpoint
CREATE INDEX "finance_budget_revision_proposals_user_policy_created_idx" ON "finance_budget_revision_proposals" ("user_id", "policy_id", "created_at");
--> statement-breakpoint
CREATE TABLE "finance_budget_policy_previews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "proposal_id" uuid NOT NULL,
  "policy_version_id" uuid NOT NULL,
  "policy_lifecycle_revision" integer NOT NULL,
  "proposal_lifecycle_revision" integer NOT NULL,
  "input_snapshot" jsonb NOT NULL,
  "result_snapshot" jsonb NOT NULL,
  "preview_hash" text NOT NULL,
  "evaluated_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_by_actor_id" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "finance_budget_policy_previews_revision_check" CHECK (policy_lifecycle_revision >= 1 AND proposal_lifecycle_revision >= 1),
  CONSTRAINT "finance_budget_policy_previews_expiry_check" CHECK (expires_at > evaluated_at),
  CONSTRAINT "finance_budget_policy_previews_input_snapshot_check" CHECK (jsonb_typeof(input_snapshot) = 'object' AND octet_length(input_snapshot::text) <= 2097152),
  CONSTRAINT "finance_budget_policy_previews_result_snapshot_check" CHECK (jsonb_typeof(result_snapshot) = 'object' AND octet_length(result_snapshot::text) <= 4194304),
  CONSTRAINT "finance_budget_policy_previews_hash_check" CHECK (preview_hash ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "finance_budget_policy_previews_execution_check" CHECK (COALESCE(result_snapshot->'executionAvailable' = 'false'::jsonb AND result_snapshot->>'kind' IN ('hypothetical_preview','denied'), false)),
  CONSTRAINT "finance_budget_policy_previews_owner_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE,
  CONSTRAINT "finance_budget_policy_previews_proposal_fk" FOREIGN KEY ("proposal_id", "user_id") REFERENCES "finance_budget_revision_proposals" ("id", "user_id"),
  CONSTRAINT "finance_budget_policy_previews_policy_version_fk" FOREIGN KEY ("policy_version_id", "user_id") REFERENCES "finance_budget_policy_versions" ("id", "user_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_budget_policy_previews_id_user_idx" ON "finance_budget_policy_previews" ("id", "user_id");
--> statement-breakpoint
CREATE INDEX "finance_budget_policy_previews_user_proposal_created_idx" ON "finance_budget_policy_previews" ("user_id", "proposal_id", "created_at", "id");
--> statement-breakpoint
CREATE INDEX "finance_budget_policy_previews_user_expiry_idx" ON "finance_budget_policy_previews" ("user_id", "expires_at");
--> statement-breakpoint
CREATE TABLE "finance_budget_period_baselines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "plan_id" uuid NOT NULL,
  "period_month" text NOT NULL,
  "period_from" text NOT NULL,
  "period_through" text NOT NULL,
  "timezone" text NOT NULL,
  "budget_version_id" uuid NOT NULL,
  "confirmed_by_actor_id" text NOT NULL,
  "confirmed_at" timestamp with time zone NOT NULL,
  CONSTRAINT "finance_budget_period_baselines_period_check" CHECK (period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND period_from = period_month || '-01' AND period_through = to_char((period_from::date + interval '1 month - 1 day'), 'YYYY-MM-DD') AND char_length(timezone) BETWEEN 1 AND 100),
  CONSTRAINT "finance_budget_period_baselines_owner_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE,
  CONSTRAINT "finance_budget_period_baselines_plan_fk" FOREIGN KEY ("plan_id", "user_id") REFERENCES "finance_budget_plans" ("id", "user_id"),
  CONSTRAINT "finance_budget_period_baselines_budget_fk" FOREIGN KEY ("budget_version_id", "user_id") REFERENCES "finance_budget_versions" ("id", "user_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_budget_period_baselines_id_user_idx" ON "finance_budget_period_baselines" ("id", "user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_budget_period_baselines_user_month_idx" ON "finance_budget_period_baselines" ("user_id", "period_month");
