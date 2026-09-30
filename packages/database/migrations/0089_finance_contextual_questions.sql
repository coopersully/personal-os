ALTER TABLE finance_accounts ADD COLUMN contextual_revision bigint NOT NULL DEFAULT 1 CONSTRAINT finance_accounts_contextual_revision_check CHECK(contextual_revision > 0);
--> statement-breakpoint
CREATE FUNCTION finance_accounts_contextual_generation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.contextual_revision <> 1 THEN RAISE EXCEPTION 'Contextual generation must start at one' USING ERRCODE='23514'; END IF;
  ELSE
    IF NEW.contextual_revision IS DISTINCT FROM OLD.contextual_revision THEN RAISE EXCEPTION 'Contextual generation is database owned' USING ERRCODE='23514'; END IF;
    IF ROW(NEW.id,NEW.user_id,NEW.provider,NEW.provider_account_id,NEW.provider_item_id,NEW.provider_item_record_id,NEW.status) IS DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.provider,OLD.provider_account_id,OLD.provider_item_id,OLD.provider_item_record_id,OLD.status) THEN
      IF OLD.contextual_revision = 9223372036854775807 THEN RAISE EXCEPTION 'Contextual generation exhausted' USING ERRCODE='23514'; END IF;
      NEW.contextual_revision := OLD.contextual_revision + 1;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER finance_accounts_contextual_generation BEFORE INSERT OR UPDATE ON finance_accounts FOR EACH ROW EXECUTE FUNCTION finance_accounts_contextual_generation();
--> statement-breakpoint
ALTER TABLE finance_transactions ADD COLUMN contextual_revision bigint NOT NULL DEFAULT 1 CONSTRAINT finance_transactions_contextual_revision_check CHECK(contextual_revision > 0);
--> statement-breakpoint
CREATE FUNCTION finance_transactions_contextual_generation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.contextual_revision <> 1 THEN RAISE EXCEPTION 'Contextual generation must start at one' USING ERRCODE='23514'; END IF;
  ELSE
    IF NEW.contextual_revision IS DISTINCT FROM OLD.contextual_revision THEN RAISE EXCEPTION 'Contextual generation is database owned' USING ERRCODE='23514'; END IF;
    IF ROW(NEW.id,NEW.user_id,NEW.account_id,NEW.merchant_id,NEW.category_id,NEW.provider_transaction_id,NEW.pending_transaction_id,NEW.provider_category,NEW.provider_category_detailed,NEW.provider_category_confidence,NEW.provider_direction,NEW.merchant,NEW.amount_cents,NEW.currency_code,NEW.direction,NEW.transaction_date,NEW.category,NEW.category_confidence_basis_points,NEW.category_source,NEW.category_rationale,NEW.category_decided_at,NEW.needs_review,NEW.pending,NEW.reconciliation_status,NEW.transfer_group_id,NEW.notes) IS DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.account_id,OLD.merchant_id,OLD.category_id,OLD.provider_transaction_id,OLD.pending_transaction_id,OLD.provider_category,OLD.provider_category_detailed,OLD.provider_category_confidence,OLD.provider_direction,OLD.merchant,OLD.amount_cents,OLD.currency_code,OLD.direction,OLD.transaction_date,OLD.category,OLD.category_confidence_basis_points,OLD.category_source,OLD.category_rationale,OLD.category_decided_at,OLD.needs_review,OLD.pending,OLD.reconciliation_status,OLD.transfer_group_id,OLD.notes) THEN
      IF OLD.contextual_revision = 9223372036854775807 THEN RAISE EXCEPTION 'Contextual generation exhausted' USING ERRCODE='23514'; END IF;
      NEW.contextual_revision := OLD.contextual_revision + 1;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER finance_transactions_contextual_generation BEFORE INSERT OR UPDATE ON finance_transactions FOR EACH ROW EXECUTE FUNCTION finance_transactions_contextual_generation();
--> statement-breakpoint
ALTER TABLE finance_review_cases ADD COLUMN contextual_revision bigint NOT NULL DEFAULT 1 CONSTRAINT finance_review_cases_contextual_revision_check CHECK(contextual_revision > 0);
--> statement-breakpoint
CREATE FUNCTION finance_review_cases_contextual_generation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.contextual_revision <> 1 THEN RAISE EXCEPTION 'Contextual generation must start at one' USING ERRCODE='23514'; END IF;
  ELSE
    IF NEW.contextual_revision IS DISTINCT FROM OLD.contextual_revision THEN RAISE EXCEPTION 'Contextual generation is database owned' USING ERRCODE='23514'; END IF;
    IF ROW(NEW.id,NEW.user_id,NEW.transaction_id,NEW.economic_event_id,NEW.stable_key,NEW.status,NEW.reason,NEW.reason_code,NEW.suggested_category_id,NEW.rationale,NEW.evidence,NEW.proposed_resolution,NEW.impact_amount_cents,NEW.reopened_from_id,NEW.resolution,NEW.resolved_by_actor_type,NEW.resolved_by_actor_id,NEW.resolution_provenance,NEW.resolved_at) IS DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.transaction_id,OLD.economic_event_id,OLD.stable_key,OLD.status,OLD.reason,OLD.reason_code,OLD.suggested_category_id,OLD.rationale,OLD.evidence,OLD.proposed_resolution,OLD.impact_amount_cents,OLD.reopened_from_id,OLD.resolution,OLD.resolved_by_actor_type,OLD.resolved_by_actor_id,OLD.resolution_provenance,OLD.resolved_at) THEN
      IF OLD.contextual_revision = 9223372036854775807 THEN RAISE EXCEPTION 'Contextual generation exhausted' USING ERRCODE='23514'; END IF;
      NEW.contextual_revision := OLD.contextual_revision + 1;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER finance_review_cases_contextual_generation BEFORE INSERT OR UPDATE ON finance_review_cases FOR EACH ROW EXECUTE FUNCTION finance_review_cases_contextual_generation();
--> statement-breakpoint
CREATE UNIQUE INDEX finance_accounts_contextual_owner_unique ON finance_accounts(user_id,id);
CREATE UNIQUE INDEX finance_transactions_contextual_parent_unique ON finance_transactions(user_id,id,account_id);
CREATE UNIQUE INDEX finance_review_cases_contextual_parent_unique ON finance_review_cases(user_id,id,transaction_id);
--> statement-breakpoint
CREATE TABLE finance_contextual_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subtype text NOT NULL CONSTRAINT finance_contextual_questions_subtype_check CHECK(subtype='manual_transaction_purpose_v1'),
  review_case_id uuid NOT NULL,
  transaction_id uuid NOT NULL,
  account_id uuid NOT NULL,
  work_revision bigint NOT NULL DEFAULT 1,
  action_revision bigint NOT NULL DEFAULT 1,
  account_revision bigint NOT NULL,
  transaction_revision bigint NOT NULL,
  review_revision bigint NOT NULL,
  dependency_adapter_version integer NOT NULL DEFAULT 1,
  state text NOT NULL DEFAULT 'open' CONSTRAINT finance_contextual_questions_state_check CHECK(state IN ('open','answered','invalidated')),
  prompt text NOT NULL,
  disclosure text NOT NULL DEFAULT 'minimal',
  merchant text NOT NULL,
  transaction_date text NOT NULL,
  amount_cents integer NOT NULL,
  currency_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_contextual_questions_revisions_check CHECK(work_revision>0 AND action_revision>0 AND account_revision>0 AND transaction_revision>0 AND review_revision>0 AND dependency_adapter_version=1),
  CONSTRAINT finance_contextual_questions_presentation_check CHECK(char_length(prompt) BETWEEN 1 AND 1000 AND prompt=btrim(prompt) AND disclosure='minimal' AND char_length(merchant) BETWEEN 1 AND 1000 AND transaction_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND (currency_code IS NULL OR currency_code ~ '^[A-Z]{3}$')),
  CONSTRAINT finance_contextual_questions_case_fk FOREIGN KEY(user_id,review_case_id,transaction_id) REFERENCES finance_review_cases(user_id,id,transaction_id) ON DELETE CASCADE,
  CONSTRAINT finance_contextual_questions_transaction_fk FOREIGN KEY(user_id,transaction_id,account_id) REFERENCES finance_transactions(user_id,id,account_id) ON DELETE CASCADE,
  CONSTRAINT finance_contextual_questions_account_fk FOREIGN KEY(user_id,account_id) REFERENCES finance_accounts(user_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX finance_contextual_questions_owner_unique ON finance_contextual_questions(user_id,id);
CREATE UNIQUE INDEX finance_contextual_questions_case_unique ON finance_contextual_questions(user_id,review_case_id,subtype);
CREATE UNIQUE INDEX finance_contextual_questions_transaction_unique ON finance_contextual_questions(user_id,transaction_id,subtype);
--> statement-breakpoint
CREATE TABLE finance_contextual_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  question_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  answered_work_revision bigint NOT NULL,
  answered_action_revision bigint NOT NULL,
  resulting_work_revision bigint NOT NULL,
  text text NOT NULL CONSTRAINT finance_contextual_answers_text_check CHECK(char_length(text) BETWEEN 1 AND 10000 AND text=btrim(text)),
  source_kind text NOT NULL,
  source_message_id text,
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  request_id text NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT finance_contextual_answers_revisions_check CHECK(answered_work_revision>0 AND answered_action_revision>0 AND resulting_work_revision::numeric=answered_work_revision::numeric+1),
  CONSTRAINT finance_contextual_answers_provenance_check CHECK(((source_kind='app' AND actor_type='user') OR (source_kind='agent' AND actor_type='agent')) AND source_message_id IS NULL AND char_length(actor_id) BETWEEN 1 AND 240 AND char_length(request_id) BETWEEN 1 AND 240),
  CONSTRAINT finance_contextual_answers_question_fk FOREIGN KEY(user_id,question_id) REFERENCES finance_contextual_questions(user_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX finance_contextual_answers_operation_unique ON finance_contextual_answers(user_id,operation_id);
CREATE UNIQUE INDEX finance_contextual_answers_revision_unique ON finance_contextual_answers(user_id,question_id,answered_work_revision);
--> statement-breakpoint
CREATE FUNCTION finance_contextual_answers_reject_update() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Contextual answers are immutable' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER finance_contextual_answers_immutable BEFORE UPDATE ON finance_contextual_answers FOR EACH ROW EXECUTE FUNCTION finance_contextual_answers_reject_update();
--> statement-breakpoint
CREATE FUNCTION finance_contextual_questions_guard_update() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF ROW(NEW.id,NEW.user_id,NEW.subtype,NEW.review_case_id,NEW.transaction_id,NEW.account_id,NEW.account_revision,NEW.transaction_revision,NEW.review_revision,NEW.dependency_adapter_version,NEW.prompt,NEW.disclosure,NEW.merchant,NEW.transaction_date,NEW.amount_cents,NEW.currency_code,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.subtype,OLD.review_case_id,OLD.transaction_id,OLD.account_id,OLD.account_revision,OLD.transaction_revision,OLD.review_revision,OLD.dependency_adapter_version,OLD.prompt,OLD.disclosure,OLD.merchant,OLD.transaction_date,OLD.amount_cents,OLD.currency_code,OLD.created_at) THEN
    RAISE EXCEPTION 'Contextual question identity and evidence cannot be replaced' USING ERRCODE='23514';
  END IF;
  IF OLD.state <> 'open' OR NEW.state NOT IN ('answered','invalidated') OR NEW.action_revision <> OLD.action_revision OR NEW.work_revision::numeric <> OLD.work_revision::numeric + 1 THEN
    RAISE EXCEPTION 'Contextual question requires one exact terminal transition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER finance_contextual_questions_guard_update BEFORE UPDATE ON finance_contextual_questions FOR EACH ROW EXECUTE FUNCTION finance_contextual_questions_guard_update();
