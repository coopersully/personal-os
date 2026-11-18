CREATE TABLE finance_budget_baseline_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_month text NOT NULL,
  plan_id uuid NOT NULL,
  budget_version_id uuid NOT NULL,
  snapshot jsonb NOT NULL,
  fingerprint text NOT NULL,
  source_fingerprint text NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT finance_budget_baseline_reviews_version_fk FOREIGN KEY (budget_version_id, plan_id, user_id) REFERENCES finance_budget_versions(id, plan_id, user_id),
  CONSTRAINT finance_budget_baseline_reviews_month_check CHECK (period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT finance_budget_baseline_reviews_snapshot_check CHECK ((jsonb_typeof(snapshot) = 'object' AND snapshot->>'month' = period_month AND snapshot->>'budgetVersionId' = budget_version_id::text AND snapshot->>'planId' = plan_id::text) IS TRUE),
  CONSTRAINT finance_budget_baseline_reviews_fingerprint_check CHECK (fingerprint ~ '^[a-f0-9]{64}$' AND source_fingerprint ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX finance_budget_baseline_reviews_id_user_idx ON finance_budget_baseline_reviews(id, user_id);
--> statement-breakpoint
CREATE TABLE finance_budget_baseline_qualifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_month text NOT NULL,
  review_id uuid NOT NULL,
  snapshot jsonb NOT NULL,
  fingerprint text NOT NULL,
  confirmed_by_actor_id text NOT NULL,
  confirmed_at timestamptz NOT NULL,
  qualification_kind text NOT NULL,
  CONSTRAINT finance_budget_baseline_qualifications_review_fk FOREIGN KEY (review_id, user_id) REFERENCES finance_budget_baseline_reviews(id, user_id),
  CONSTRAINT finance_budget_baseline_qualifications_month_check CHECK (period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT finance_budget_baseline_qualifications_snapshot_check CHECK ((jsonb_typeof(snapshot) = 'object' AND snapshot->>'month' = period_month) IS TRUE),
  CONSTRAINT finance_budget_baseline_qualifications_fingerprint_check CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT finance_budget_baseline_qualifications_kind_check CHECK (qualification_kind IN ('current', 'retrospective')),
  CONSTRAINT finance_budget_baseline_qualifications_human_check CHECK (confirmed_by_actor_id = user_id::text)
);
CREATE UNIQUE INDEX finance_budget_baseline_qualifications_user_month_idx ON finance_budget_baseline_qualifications(user_id, period_month);
--> statement-breakpoint
CREATE FUNCTION finance_budget_baseline_reject_snapshot_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Finance baseline review and qualification snapshots are immutable';
END;
$$;
CREATE TRIGGER finance_budget_baseline_reviews_immutable BEFORE UPDATE ON finance_budget_baseline_reviews FOR EACH ROW EXECUTE FUNCTION finance_budget_baseline_reject_snapshot_update();
CREATE TRIGGER finance_budget_baseline_qualifications_immutable BEFORE UPDATE ON finance_budget_baseline_qualifications FOR EACH ROW EXECUTE FUNCTION finance_budget_baseline_reject_snapshot_update();
