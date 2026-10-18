-- Relationship state is derived by the database, never supplied by a writer.
-- Baseline existing rows before installing the guard, in this migration transaction.
ALTER TABLE finance_transactions
  ADD COLUMN reimbursement_relationship_revision bigint NOT NULL DEFAULT 1
    CONSTRAINT finance_transactions_reimbursement_relationship_revision_check CHECK (reimbursement_relationship_revision > 0),
  ADD COLUMN reimbursement_relationship_state jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
CREATE FUNCTION finance_reimbursement_relationship_state(owner_id uuid, transaction_id uuid)
RETURNS jsonb LANGUAGE sql VOLATILE SET search_path=pg_catalog AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_array(m.id, m.user_id, m.reimbursement_id, m.amount_cents) ORDER BY m.id), '[]'::jsonb)
  FROM public.finance_reimbursement_matches m
  WHERE m.user_id=owner_id AND m.credit_transaction_id=transaction_id
$$;
--> statement-breakpoint
UPDATE finance_transactions t
SET reimbursement_relationship_state=finance_reimbursement_relationship_state(t.user_id,t.id);
--> statement-breakpoint
CREATE FUNCTION finance_transactions_reimbursement_relationship_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE current_state jsonb;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.reimbursement_relationship_revision<>1 OR NEW.reimbursement_relationship_state IS DISTINCT FROM '[]'::jsonb THEN
      RAISE EXCEPTION 'Reimbursement relationship generation is database owned' USING ERRCODE='23514';
    END IF;
  ELSE
    IF NEW.reimbursement_relationship_revision IS DISTINCT FROM OLD.reimbursement_relationship_revision
      OR NEW.reimbursement_relationship_state IS DISTINCT FROM OLD.reimbursement_relationship_state THEN
      RAISE EXCEPTION 'Reimbursement relationship generation is database owned' USING ERRCODE='23514';
    END IF;
  END IF;
  current_state := public.finance_reimbursement_relationship_state(NEW.user_id,NEW.id);
  IF TG_OP='UPDATE' AND current_state IS DISTINCT FROM OLD.reimbursement_relationship_state THEN
    IF OLD.reimbursement_relationship_revision=9223372036854775807 THEN
      RAISE EXCEPTION 'Reimbursement relationship generation exhausted' USING ERRCODE='23514';
    END IF;
    NEW.reimbursement_relationship_revision := OLD.reimbursement_relationship_revision+1;
  END IF;
  NEW.reimbursement_relationship_state := current_state;
  RETURN NEW;
END;
$$;
CREATE TRIGGER finance_transactions_reimbursement_relationship_guard
BEFORE INSERT OR UPDATE ON finance_transactions FOR EACH ROW
EXECUTE FUNCTION finance_transactions_reimbursement_relationship_guard();
--> statement-breakpoint
-- Canonical writers must acquire topology locks before any row locks. A row
-- trigger cannot establish this order retroactively for arbitrary raw UPDATE.
-- For moves, callers prelock both owners and old/new credits in sorted order.
CREATE FUNCTION finance_reimbursement_relationship_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE old_owner uuid; new_owner uuid; old_credit uuid; new_credit uuid; owner_id uuid; credit record;
BEGIN
  IF TG_OP<>'INSERT' THEN old_owner:=OLD.user_id; old_credit:=OLD.credit_transaction_id; END IF;
  IF TG_OP<>'DELETE' THEN new_owner:=NEW.user_id; new_credit:=NEW.credit_transaction_id; END IF;
  IF TG_OP='UPDATE' AND ROW(NEW.id,NEW.user_id,NEW.reimbursement_id,NEW.credit_transaction_id,NEW.amount_cents)
    IS NOT DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.reimbursement_id,OLD.credit_transaction_id,OLD.amount_cents) THEN RETURN NULL; END IF;
  FOR owner_id IN SELECT DISTINCT value FROM unnest(ARRAY[old_owner,new_owner]) value WHERE value IS NOT NULL ORDER BY value LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('finance-reimbursement-topology:' || owner_id::text,0));
  END LOOP;
  FOR credit IN SELECT t.user_id,t.id FROM public.finance_transactions t
    WHERE ((t.user_id=old_owner AND t.id=old_credit) OR (t.user_id=new_owner AND t.id=new_credit))
      AND EXISTS (SELECT 1 FROM public.users u WHERE u.id=t.user_id)
    ORDER BY t.user_id,t.id FOR UPDATE OF t LOOP
    -- No generation/state input: the parent guard derives actual current state.
    UPDATE public.finance_transactions SET id=id WHERE id=credit.id AND user_id=credit.user_id;
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE TRIGGER finance_reimbursement_relationship_touch
AFTER INSERT OR UPDATE OR DELETE ON finance_reimbursement_matches FOR EACH ROW
EXECUTE FUNCTION finance_reimbursement_relationship_touch();
--> statement-breakpoint
CREATE FUNCTION finance_reimbursement_relationship_reject_truncate()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Reimbursement relationship history cannot be truncated' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER finance_reimbursement_relationship_reject_truncate
BEFORE TRUNCATE ON finance_reimbursement_matches FOR EACH STATEMENT
EXECUTE FUNCTION finance_reimbursement_relationship_reject_truncate();
--> statement-breakpoint
ALTER TABLE finance_balance_inclusions
  ADD COLUMN reimbursement_relationship_revision bigint
    CONSTRAINT fin_balance_inclusion_relationship_revision_check CHECK (reimbursement_relationship_revision IS NULL OR reimbursement_relationship_revision > 0);
