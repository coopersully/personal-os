-- Expand only: existing obligations receive a revision, never confirmed planning evidence.
ALTER TABLE finance_recurring_obligations ADD COLUMN revision integer NOT NULL DEFAULT 1;
ALTER TABLE finance_recurring_obligations ADD CONSTRAINT finance_recurring_revision_check CHECK (revision > 0);
CREATE UNIQUE INDEX finance_goals_owner_id_idx ON finance_goals(user_id,id);
CREATE UNIQUE INDEX finance_recurring_owner_id_idx ON finance_recurring_obligations(user_id,id);
--> statement-breakpoint
CREATE TABLE finance_planning_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 goal_id uuid,
 obligation_id uuid,
 source_revision integer NOT NULL,
 amount_cents bigint NOT NULL,
 currency_code text NOT NULL,
 fixedness text,
 as_of text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 -- Immutable snapshot; intentionally no account FK or ON DELETE SET NULL.
 bound_account_id uuid,
 bound_cadence text,
 CONSTRAINT finance_planning_evidence_source_check CHECK ((goal_id IS NOT NULL) <> (obligation_id IS NOT NULL)),
 CONSTRAINT finance_planning_evidence_revision_check CHECK (source_revision > 0),
 CONSTRAINT finance_planning_evidence_amount_check CHECK (amount_cents BETWEEN 0 AND 10000000000),
 CONSTRAINT finance_planning_evidence_currency_check CHECK (currency_code ~ '^[A-Z]{3}$'),
 CONSTRAINT finance_planning_evidence_actor_check CHECK (actor_user_id = user_id),
 CONSTRAINT finance_planning_evidence_date_check CHECK (as_of ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND to_char(as_of::date, 'YYYY-MM-DD') = as_of),
 CONSTRAINT finance_planning_evidence_binding_check CHECK (
  (obligation_id IS NOT NULL AND fixedness IS NOT NULL AND fixedness IN ('fixed','variable') AND bound_cadence IS NOT NULL AND bound_cadence IN ('weekly','biweekly','semimonthly','monthly','quarterly','yearly','irregular'))
  OR (goal_id IS NOT NULL AND fixedness IS NULL AND bound_account_id IS NULL AND bound_cadence IS NULL)
 ),
 CONSTRAINT finance_planning_evidence_goal_owner_fk FOREIGN KEY(user_id,goal_id) REFERENCES finance_goals(user_id,id),
 CONSTRAINT finance_planning_evidence_obligation_owner_fk FOREIGN KEY(user_id,obligation_id) REFERENCES finance_recurring_obligations(user_id,id)
);
CREATE INDEX finance_planning_evidence_goal_idx ON finance_planning_evidence(user_id,goal_id,recorded_at);
CREATE INDEX finance_planning_evidence_obligation_idx ON finance_planning_evidence(user_id,obligation_id,recorded_at);
--> statement-breakpoint
CREATE FUNCTION finance_planning_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id) THEN
  RETURN OLD;
 END IF;
 RAISE EXCEPTION 'Finance planning evidence is append-only except for owner erasure' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER finance_planning_evidence_immutable BEFORE UPDATE OR DELETE ON finance_planning_evidence
FOR EACH ROW EXECUTE FUNCTION finance_planning_evidence_guard();
