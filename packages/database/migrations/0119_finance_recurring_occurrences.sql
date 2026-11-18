-- Expand only; existing schedules, matches, and balance inclusion remain unknown.
ALTER TABLE finance_income_streams ADD COLUMN revision integer NOT NULL DEFAULT 1;
ALTER TABLE finance_income_streams ADD CONSTRAINT finance_income_revision_check CHECK (revision > 0);
CREATE UNIQUE INDEX finance_income_owner_id_idx ON finance_income_streams(user_id,id);
--> statement-breakpoint
CREATE TABLE finance_recurring_schedule_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 income_stream_id uuid,
 obligation_id uuid,
 source_revision integer NOT NULL,
 account_id uuid,
 cadence text NOT NULL,
 timezone text NOT NULL,
 anchor_local_date text NOT NULL,
 effective_from text NOT NULL,
 semimonthly_days integer[],
 amount_cents bigint,
 amount_basis text NOT NULL,
 currency_code text NOT NULL,
 supersedes_id uuid,
 CONSTRAINT fin_schedule_source_check CHECK ((income_stream_id IS NOT NULL) <> (obligation_id IS NOT NULL)),
 CONSTRAINT fin_schedule_revision_check CHECK (source_revision > 0),
 CONSTRAINT fin_schedule_amount_check CHECK (amount_cents IS NULL OR amount_cents BETWEEN 0 AND 10000000000),
 CONSTRAINT fin_schedule_basis_check CHECK (amount_basis IN ('fixed','variable','unknown') AND (amount_basis <> 'fixed' OR amount_cents IS NOT NULL)),
 CONSTRAINT fin_schedule_currency_check CHECK (currency_code ~ '^[A-Z]{3}$'),
 CONSTRAINT fin_schedule_cadence_check CHECK (cadence IN ('weekly','biweekly','semimonthly','monthly','quarterly','yearly','irregular','unknown')),
 CONSTRAINT fin_schedule_timezone_check CHECK (length(btrim(timezone)) BETWEEN 1 AND 100),
 CONSTRAINT fin_schedule_anchor_check CHECK (anchor_local_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND to_char(anchor_local_date::date, 'YYYY-MM-DD') = anchor_local_date),
 CONSTRAINT fin_schedule_effective_check CHECK (effective_from ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND to_char(effective_from::date, 'YYYY-MM-DD') = effective_from),
 CONSTRAINT fin_schedule_slots_check CHECK ((cadence = 'semimonthly' AND semimonthly_days IS NOT NULL AND array_ndims(semimonthly_days) = 1 AND array_lower(semimonthly_days,1) = 1 AND cardinality(semimonthly_days) = 2 AND semimonthly_days[1] IS NOT NULL AND semimonthly_days[2] IS NOT NULL AND semimonthly_days[1] BETWEEN 1 AND 31 AND semimonthly_days[2] BETWEEN 1 AND 31 AND semimonthly_days[1] <> semimonthly_days[2]) OR (cadence <> 'semimonthly' AND semimonthly_days IS NULL)),
 CONSTRAINT fin_schedule_actor_check CHECK (actor_user_id = user_id),
 CONSTRAINT fin_schedule_self_check CHECK (supersedes_id IS NULL OR supersedes_id <> id),
 CONSTRAINT fin_schedule_account_fk FOREIGN KEY(user_id,account_id) REFERENCES finance_accounts(user_id,id),
 CONSTRAINT fin_schedule_income_fk FOREIGN KEY(user_id,income_stream_id) REFERENCES finance_income_streams(user_id,id),
 CONSTRAINT fin_schedule_obligation_fk FOREIGN KEY(user_id,obligation_id) REFERENCES finance_recurring_obligations(user_id,id)
);
CREATE UNIQUE INDEX fin_schedule_owner_id_idx ON finance_recurring_schedule_versions(user_id,id);
ALTER TABLE finance_recurring_schedule_versions ADD CONSTRAINT fin_schedule_supersedes_fk FOREIGN KEY(user_id,supersedes_id) REFERENCES finance_recurring_schedule_versions(user_id,id);
CREATE UNIQUE INDEX fin_schedule_income_revision_idx ON finance_recurring_schedule_versions(user_id,income_stream_id,source_revision);
CREATE UNIQUE INDEX fin_schedule_obligation_revision_idx ON finance_recurring_schedule_versions(user_id,obligation_id,source_revision);
CREATE UNIQUE INDEX fin_schedule_supersedes_idx ON finance_recurring_schedule_versions(user_id,supersedes_id);
--> statement-breakpoint
CREATE TABLE finance_recurring_occurrences (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 schedule_version_id uuid NOT NULL,
 local_date text NOT NULL,
 slot integer NOT NULL,
 expected_amount_cents bigint,
 currency_code text NOT NULL,
 CONSTRAINT fin_occurrence_date_check CHECK (local_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND to_char(local_date::date, 'YYYY-MM-DD') = local_date),
 CONSTRAINT fin_occurrence_slot_check CHECK (slot BETWEEN 0 AND 1),
 CONSTRAINT fin_occurrence_amount_check CHECK (expected_amount_cents IS NULL OR expected_amount_cents BETWEEN 0 AND 10000000000),
 CONSTRAINT fin_occurrence_currency_check CHECK (currency_code ~ '^[A-Z]{3}$'),
 CONSTRAINT fin_occurrence_version_fk FOREIGN KEY(user_id,schedule_version_id) REFERENCES finance_recurring_schedule_versions(user_id,id)
);
CREATE UNIQUE INDEX fin_occurrence_owner_id_idx ON finance_recurring_occurrences(user_id,id);
CREATE UNIQUE INDEX fin_occurrence_identity_idx ON finance_recurring_occurrences(user_id,schedule_version_id,local_date,slot);
--> statement-breakpoint
CREATE TABLE finance_occurrence_match_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 occurrence_id uuid NOT NULL,
 kind text NOT NULL,
 allocation_id uuid,
 income_transaction_id uuid,
 amount_cents bigint NOT NULL,
 currency_code text NOT NULL,
 allocation_revision integer,
 transaction_revision bigint NOT NULL,
 source_evidence jsonb NOT NULL,
 rationale text NOT NULL,
 reverses_match_id uuid,
 CONSTRAINT fin_occ_match_kind_check CHECK (kind IN ('match','reverse')),
 CONSTRAINT fin_occ_match_source_check CHECK ((kind = 'match' AND reverses_match_id IS NULL AND ((allocation_id IS NOT NULL AND income_transaction_id IS NULL AND allocation_revision IS NOT NULL AND allocation_revision > 0) OR (income_transaction_id IS NOT NULL AND allocation_id IS NULL AND allocation_revision IS NULL))) OR (kind = 'reverse' AND reverses_match_id IS NOT NULL AND allocation_id IS NULL AND income_transaction_id IS NULL AND allocation_revision IS NULL)),
 CONSTRAINT fin_occ_match_amount_check CHECK (amount_cents BETWEEN 1 AND 10000000000),
 CONSTRAINT fin_occ_match_revision_check CHECK (transaction_revision > 0),
 CONSTRAINT fin_occ_match_currency_check CHECK (currency_code ~ '^[A-Z]{3}$'),
 CONSTRAINT fin_occ_match_evidence_check CHECK (jsonb_typeof(source_evidence) = 'object'),
 CONSTRAINT fin_occ_match_rationale_check CHECK (length(btrim(rationale)) BETWEEN 1 AND 2000),
 CONSTRAINT fin_occ_match_actor_check CHECK (actor_user_id = user_id),
 CONSTRAINT fin_occ_match_self_check CHECK (reverses_match_id IS NULL OR reverses_match_id <> id),
 CONSTRAINT fin_occ_match_occurrence_fk FOREIGN KEY(user_id,occurrence_id) REFERENCES finance_recurring_occurrences(user_id,id),
 CONSTRAINT fin_occ_match_allocation_fk FOREIGN KEY(allocation_id,user_id) REFERENCES finance_transaction_allocations(id,user_id),
 CONSTRAINT fin_occ_match_income_fk FOREIGN KEY(income_transaction_id,user_id) REFERENCES finance_transactions(id,user_id)
);
CREATE UNIQUE INDEX fin_occ_match_owner_id_idx ON finance_occurrence_match_events(user_id,id);
ALTER TABLE finance_occurrence_match_events ADD CONSTRAINT fin_occ_match_reverses_fk FOREIGN KEY(user_id,reverses_match_id) REFERENCES finance_occurrence_match_events(user_id,id);
CREATE UNIQUE INDEX fin_occ_match_reversal_idx ON finance_occurrence_match_events(user_id,reverses_match_id);
--> statement-breakpoint
CREATE TABLE finance_cash_balance_bases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 account_id uuid NOT NULL,
 basis_revision integer NOT NULL,
 account_contextual_revision bigint NOT NULL,
 kind text NOT NULL,
 amount_cents bigint NOT NULL,
 currency_code text NOT NULL,
 as_of timestamptz NOT NULL,
 valid_until timestamptz NOT NULL,
 protected_floor_cents bigint,
 CONSTRAINT fin_balance_basis_revision_check CHECK (basis_revision > 0 AND account_contextual_revision > 0),
 CONSTRAINT fin_balance_basis_kind_check CHECK (kind IN ('current','available')),
 CONSTRAINT fin_balance_basis_amount_check CHECK (amount_cents BETWEEN -10000000000 AND 10000000000),
 CONSTRAINT fin_balance_basis_currency_check CHECK (currency_code ~ '^[A-Z]{3}$'),
 CONSTRAINT fin_balance_basis_validity_check CHECK (valid_until >= as_of),
 CONSTRAINT fin_balance_basis_floor_check CHECK (protected_floor_cents IS NULL OR protected_floor_cents BETWEEN 0 AND 10000000000),
 CONSTRAINT fin_balance_basis_actor_check CHECK (actor_user_id = user_id),
 CONSTRAINT fin_balance_basis_account_fk FOREIGN KEY(user_id,account_id) REFERENCES finance_accounts(user_id,id)
);
CREATE UNIQUE INDEX fin_balance_basis_owner_id_idx ON finance_cash_balance_bases(user_id,id);
CREATE UNIQUE INDEX fin_balance_basis_revision_idx ON finance_cash_balance_bases(user_id,account_id,basis_revision);
--> statement-breakpoint
CREATE TABLE finance_balance_inclusions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 basis_id uuid NOT NULL,
 transaction_id uuid NOT NULL,
 transaction_contextual_revision bigint NOT NULL,
 reflection text NOT NULL,
 CONSTRAINT fin_balance_inclusion_revision_check CHECK (transaction_contextual_revision > 0),
 CONSTRAINT fin_balance_inclusion_reflection_check CHECK (reflection IN ('included','not_included')),
 CONSTRAINT fin_balance_inclusion_basis_fk FOREIGN KEY(user_id,basis_id) REFERENCES finance_cash_balance_bases(user_id,id),
 CONSTRAINT fin_balance_inclusion_transaction_fk FOREIGN KEY(transaction_id,user_id) REFERENCES finance_transactions(id,user_id)
);
CREATE UNIQUE INDEX fin_balance_inclusion_owner_id_idx ON finance_balance_inclusions(user_id,id);
CREATE UNIQUE INDEX fin_balance_inclusion_transaction_idx ON finance_balance_inclusions(user_id,basis_id,transaction_id);
--> statement-breakpoint
CREATE FUNCTION finance_occurrence_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Finance occurrence evidence is append-only except for owner erasure' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER finance_recurring_schedule_versions_immutable BEFORE UPDATE OR DELETE ON finance_recurring_schedule_versions FOR EACH ROW EXECUTE FUNCTION finance_occurrence_history_guard();
CREATE TRIGGER finance_recurring_occurrences_immutable BEFORE UPDATE OR DELETE ON finance_recurring_occurrences FOR EACH ROW EXECUTE FUNCTION finance_occurrence_history_guard();
CREATE TRIGGER finance_occurrence_match_events_immutable BEFORE UPDATE OR DELETE ON finance_occurrence_match_events FOR EACH ROW EXECUTE FUNCTION finance_occurrence_history_guard();
CREATE TRIGGER finance_cash_balance_bases_immutable BEFORE UPDATE OR DELETE ON finance_cash_balance_bases FOR EACH ROW EXECUTE FUNCTION finance_occurrence_history_guard();
CREATE TRIGGER finance_balance_inclusions_immutable BEFORE UPDATE OR DELETE ON finance_balance_inclusions FOR EACH ROW EXECUTE FUNCTION finance_occurrence_history_guard();
