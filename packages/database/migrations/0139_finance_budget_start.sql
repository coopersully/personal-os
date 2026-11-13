CREATE TABLE finance_budget_start_policies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 revision integer NOT NULL CONSTRAINT finance_budget_start_revision_positive CHECK (revision > 0),
 first_month text CONSTRAINT finance_budget_start_month_valid CHECK (first_month IS NULL OR first_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 timezone text NOT NULL,
 approved_at timestamptz NOT NULL,
 approved_by text NOT NULL,
 preview_id uuid NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX finance_budget_start_owner_revision ON finance_budget_start_policies(user_id, revision);
--> statement-breakpoint
CREATE UNIQUE INDEX finance_budget_start_preview ON finance_budget_start_policies(preview_id);
--> statement-breakpoint
CREATE TABLE finance_budget_start_previews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 actor_id text NOT NULL,
 actor_type text NOT NULL CONSTRAINT finance_budget_start_preview_actor CHECK (actor_type IN ('user', 'agent')),
 idempotency_key text NOT NULL,
 fingerprint text NOT NULL,
 attention jsonb NOT NULL,
 first_month text CONSTRAINT finance_budget_start_preview_month CHECK (first_month IS NULL OR first_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 timezone text NOT NULL,
 expected_policy_revision integer NOT NULL CONSTRAINT finance_budget_start_preview_revision CHECK (expected_policy_revision >= 0),
 created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX finance_budget_start_preview_owner_key ON finance_budget_start_previews(user_id, idempotency_key);
