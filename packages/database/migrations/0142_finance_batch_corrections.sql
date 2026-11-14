CREATE TABLE finance_review_batch_effects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 batch_id uuid NOT NULL REFERENCES finance_review_batch_runs(id) ON DELETE CASCADE,
 outcome_index integer NOT NULL CHECK(outcome_index BETWEEN 0 AND 99),
 before jsonb NOT NULL, after jsonb NOT NULL, created_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX finance_batch_effect_unique ON finance_review_batch_effects(batch_id,outcome_index);
--> statement-breakpoint
CREATE TABLE finance_review_batch_corrections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 batch_id uuid NOT NULL REFERENCES finance_review_batch_runs(id) ON DELETE CASCADE,
 actor_id text NOT NULL, actor_type text NOT NULL CHECK(actor_type IN ('user','agent')), authorization_connection_id uuid,
 idempotency_key text NOT NULL, fingerprint text NOT NULL,
 outcome_indexes jsonb NOT NULL, outcomes jsonb NOT NULL DEFAULT '[]',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX finance_batch_correction_owner_key ON finance_review_batch_corrections(user_id,idempotency_key);

--> statement-breakpoint
ALTER TABLE finance_classification_decisions ADD COLUMN retracted_at timestamptz;
