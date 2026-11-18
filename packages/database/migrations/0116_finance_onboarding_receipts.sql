CREATE TABLE finance_onboarding_states (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 revision integer NOT NULL DEFAULT 0,
 completed_at timestamptz,
 answers jsonb NOT NULL DEFAULT '[]'::jsonb,
 display_preferences_reviewed boolean NOT NULL DEFAULT false,
 automation_choice text,
 updated_at timestamptz NOT NULL,
 CONSTRAINT finance_onboarding_states_revision_check CHECK (revision >= 0),
 CONSTRAINT finance_onboarding_states_answers_check CHECK (jsonb_typeof(answers) = 'array' AND jsonb_array_length(answers) <= 100),
 CONSTRAINT finance_onboarding_states_choice_check CHECK (automation_choice IS NULL OR automation_choice IN ('later','now')),
 CONSTRAINT finance_onboarding_states_completion_check CHECK (completed_at IS NULL OR (revision > 0 AND automation_choice IS NOT NULL AND display_preferences_reviewed))
);
--> statement-breakpoint
CREATE TABLE finance_onboarding_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 idempotency_key text NOT NULL,
 operation text NOT NULL,
 request_hash text NOT NULL,
 result jsonb NOT NULL,
 actor_type text NOT NULL,
 actor_id text,
 created_at timestamptz NOT NULL,
 CONSTRAINT finance_onboarding_receipts_key_check CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
 CONSTRAINT finance_onboarding_receipts_operation_check CHECK (operation IN ('save','complete')),
 CONSTRAINT finance_onboarding_receipts_hash_check CHECK (request_hash ~ '^[a-f0-9]{64}$'),
 CONSTRAINT finance_onboarding_receipts_result_check CHECK (jsonb_typeof(result) = 'object')
);
CREATE UNIQUE INDEX finance_onboarding_receipts_owner_key_idx ON finance_onboarding_receipts(user_id,idempotency_key);
--> statement-breakpoint
CREATE FUNCTION protect_finance_onboarding_completion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.revision <> OLD.revision + 1 THEN
  RAISE EXCEPTION 'Finance onboarding owner and revision are immutable except for the next revision' USING ERRCODE = '23514';
 END IF;
 IF OLD.completed_at IS NOT NULL AND NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
  RAISE EXCEPTION 'Finance onboarding completion cannot be cleared or rewritten' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER finance_onboarding_states_completion_guard BEFORE UPDATE ON finance_onboarding_states
FOR EACH ROW EXECUTE FUNCTION protect_finance_onboarding_completion();
