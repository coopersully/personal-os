ALTER TABLE finance_review_cases ADD COLUMN human_action jsonb NOT NULL DEFAULT '{"state":"absent"}'::jsonb;
ALTER TABLE finance_review_cases ADD COLUMN action_revision bigint NOT NULL DEFAULT 0 CHECK(action_revision>=0);
--> statement-breakpoint
CREATE UNIQUE INDEX finance_review_cases_action_owner_unique ON finance_review_cases(user_id,id);
CREATE TABLE finance_review_action_requests (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 review_case_id uuid NOT NULL,
 authority_operation_id uuid NOT NULL,
 action_revision bigint NOT NULL CHECK(action_revision>0),
 state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','consumed','withdrawn')),
 terminal_operation_id uuid,
 request jsonb NOT NULL,
 prompt text NOT NULL CHECK(char_length(prompt) BETWEEN 1 AND 1000),
 CHECK((state='open' AND terminal_operation_id IS NULL) OR (state<>'open' AND terminal_operation_id IS NOT NULL)),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(user_id,review_case_id) REFERENCES finance_review_cases(user_id,id) ON DELETE CASCADE,
 CHECK((jsonb_typeof(request)='object' AND request->>'requestId'=id::text AND request->>'authorityOperationId'=authority_operation_id::text AND request->'work'->>'id'=review_case_id::text AND request->'work'->>'actionRevision'=action_revision::text) IS TRUE),
 CHECK(id<>authority_operation_id AND id<>review_case_id AND authority_operation_id<>review_case_id)
);
CREATE UNIQUE INDEX finance_review_action_requests_owner_unique ON finance_review_action_requests(user_id,id);
CREATE UNIQUE INDEX finance_review_action_requests_terminal_unique ON finance_review_action_requests(user_id,terminal_operation_id);
CREATE UNIQUE INDEX finance_review_action_requests_authority_unique ON finance_review_action_requests(user_id,authority_operation_id);
CREATE UNIQUE INDEX finance_review_action_requests_revision_unique ON finance_review_action_requests(user_id,review_case_id,action_revision);
CREATE FUNCTION finance_review_action_requests_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' THEN
   IF NEW.state<>'open' OR NEW.terminal_operation_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.finance_review_cases c WHERE c.user_id=NEW.user_id AND c.id=NEW.review_case_id AND NEW.action_revision::numeric=c.action_revision::numeric+1 AND NEW.request->'work'->>'revision'=(c.contextual_revision::numeric+1)::text) THEN RAISE EXCEPTION 'Issuance requires the exact next case generation' USING ERRCODE='23514'; END IF;
   RETURN NEW;
 END IF;
 IF ROW(NEW.id,NEW.user_id,NEW.review_case_id,NEW.authority_operation_id,NEW.action_revision,NEW.request,NEW.prompt,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.review_case_id,OLD.authority_operation_id,OLD.action_revision,OLD.request,OLD.prompt,OLD.created_at) OR OLD.state<>'open' OR NEW.state NOT IN ('consumed','withdrawn') OR NEW.terminal_operation_id IS NULL OR NEW.terminal_operation_id IN (NEW.id,NEW.authority_operation_id,NEW.review_case_id) THEN RAISE EXCEPTION 'Issuance is immutable and terminal once' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER finance_review_action_requests_immutable BEFORE INSERT OR UPDATE ON finance_review_action_requests FOR EACH ROW EXECUTE FUNCTION finance_review_action_requests_guard();
--> statement-breakpoint
CREATE TABLE finance_review_answers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 review_case_id uuid NOT NULL,
 request_id uuid NOT NULL,
 operation_id uuid NOT NULL,
 answered_work_revision bigint NOT NULL,
 answered_action_revision bigint NOT NULL,
 resulting_work_revision bigint NOT NULL,
 text text NOT NULL CHECK(char_length(text) BETWEEN 1 AND 10000 AND text=btrim(text)),
 source_kind text NOT NULL CHECK(source_kind IN ('app','agent','sms')),
 inbound_message_id uuid,
 reply_binding_id uuid,
 actor_type text NOT NULL CHECK(actor_type IN ('user','agent')),
 actor_id text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(user_id,review_case_id) REFERENCES finance_review_cases(user_id,id) ON DELETE CASCADE,
 FOREIGN KEY(user_id,request_id) REFERENCES finance_review_action_requests(user_id,id) ON DELETE CASCADE,
 CONSTRAINT finance_review_answers_revision_check CHECK(answered_work_revision>0 AND answered_action_revision>0 AND resulting_work_revision::numeric=answered_work_revision::numeric+1),
 CHECK((source_kind='sms' AND actor_type='user' AND actor_id=user_id::text AND inbound_message_id IS NOT NULL AND reply_binding_id IS NOT NULL) OR (source_kind IN ('app','agent') AND inbound_message_id IS NULL AND reply_binding_id IS NULL))
);
CREATE UNIQUE INDEX finance_review_answers_operation_unique ON finance_review_answers(user_id,operation_id);
CREATE UNIQUE INDEX finance_review_answers_request_unique ON finance_review_answers(user_id,request_id);
CREATE UNIQUE INDEX finance_review_answers_sms_binding_unique ON finance_review_answers(user_id,reply_binding_id);
CREATE TRIGGER finance_review_answers_immutable BEFORE UPDATE ON finance_review_answers FOR EACH ROW EXECUTE FUNCTION finance_contextual_answers_reject_update();
--> statement-breakpoint
CREATE TABLE finance_answer_continuations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 operation_id uuid NOT NULL,
 review_case_id uuid NOT NULL,
 transaction_id uuid NOT NULL,
 resulting_work_revision bigint NOT NULL CHECK(resulting_work_revision>0),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','accepted','completed','unavailable')),
 maintenance_run_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX finance_answer_continuations_operation_unique ON finance_answer_continuations(user_id,operation_id);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION finance_review_cases_contextual_generation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.action_revision <> 0 OR NEW.human_action <> '{"state":"absent"}'::jsonb THEN RAISE EXCEPTION 'Review actions require durable issuance' USING ERRCODE='23514'; END IF;
    IF NEW.contextual_revision <> 1 THEN RAISE EXCEPTION 'Contextual generation must start at one' USING ERRCODE='23514'; END IF;
  ELSE
    IF NEW.action_revision IS DISTINCT FROM OLD.action_revision THEN RAISE EXCEPTION 'Action revision is database owned' USING ERRCODE='23514'; END IF;
    IF NEW.human_action IS DISTINCT FROM OLD.human_action THEN
      IF (jsonb_typeof(NEW.human_action)='object' AND NEW.human_action->>'state' IN ('open','consumed','withdrawn') AND jsonb_typeof(NEW.human_action->'request')='object') IS NOT TRUE THEN RAISE EXCEPTION 'Invalid action transition' USING ERRCODE='23514'; END IF;
      IF NEW.human_action->'request'->>'requestId' IS DISTINCT FROM OLD.human_action->'request'->>'requestId' THEN
        IF OLD.action_revision=9223372036854775807 THEN RAISE EXCEPTION 'Action revision exhausted' USING ERRCODE='23514'; END IF;
        IF OLD.human_action->>'state'='open' AND NOT EXISTS(SELECT 1 FROM public.finance_review_action_requests r WHERE r.id=(OLD.human_action->'request'->>'requestId')::uuid AND r.user_id=OLD.user_id AND r.state='withdrawn') THEN RAISE EXCEPTION 'Prior issuance must be retired atomically' USING ERRCODE='23514'; END IF;
        NEW.action_revision:=OLD.action_revision+1;
        IF NEW.human_action->>'state'<>'open' OR NOT EXISTS(SELECT 1 FROM public.finance_review_action_requests r WHERE r.id=(NEW.human_action->'request'->>'requestId')::uuid AND r.user_id=NEW.user_id AND r.review_case_id=NEW.id AND r.action_revision=NEW.action_revision AND r.request=NEW.human_action->'request' AND r.state='open') THEN RAISE EXCEPTION 'Missing exact immutable issuance' USING ERRCODE='23514'; END IF;
      ELSIF OLD.human_action->>'state'<>'open' OR NEW.human_action->>'state' NOT IN ('consumed','withdrawn') OR NEW.human_action->'request' IS DISTINCT FROM OLD.human_action->'request' THEN
        RAISE EXCEPTION 'Terminal request cannot be replaced or reopened' USING ERRCODE='23514';
      END IF;
      IF NEW.human_action->>'state' IN ('consumed','withdrawn') AND NOT EXISTS(SELECT 1 FROM public.finance_review_action_requests r WHERE r.id=(NEW.human_action->'request'->>'requestId')::uuid AND r.user_id=NEW.user_id AND r.state=NEW.human_action->>'state' AND r.terminal_operation_id=(NEW.human_action->'terminal'->>'operationId')::uuid) THEN RAISE EXCEPTION 'Missing terminal ledger evidence' USING ERRCODE='23514'; END IF;
      IF (NEW.human_action->'request'->'work'->>'actionRevision'=NEW.action_revision::text) IS NOT TRUE THEN RAISE EXCEPTION 'Wrong action revision' USING ERRCODE='23514'; END IF;
    END IF;
    IF NEW.contextual_revision IS DISTINCT FROM OLD.contextual_revision THEN RAISE EXCEPTION 'Contextual generation is database owned' USING ERRCODE='23514'; END IF;
    IF ROW(NEW.id,NEW.user_id,NEW.transaction_id,NEW.economic_event_id,NEW.stable_key,NEW.status,NEW.reason,NEW.reason_code,NEW.suggested_category_id,NEW.rationale,NEW.evidence,NEW.proposed_resolution,NEW.impact_amount_cents,NEW.reopened_from_id,NEW.resolution,NEW.resolved_by_actor_type,NEW.resolved_by_actor_id,NEW.resolution_provenance,NEW.resolved_at,NEW.human_action,NEW.action_revision) IS DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.transaction_id,OLD.economic_event_id,OLD.stable_key,OLD.status,OLD.reason,OLD.reason_code,OLD.suggested_category_id,OLD.rationale,OLD.evidence,OLD.proposed_resolution,OLD.impact_amount_cents,OLD.reopened_from_id,OLD.resolution,OLD.resolved_by_actor_type,OLD.resolved_by_actor_id,OLD.resolution_provenance,OLD.resolved_at,OLD.human_action,OLD.action_revision) THEN
      IF OLD.contextual_revision = 9223372036854775807 THEN RAISE EXCEPTION 'Contextual generation exhausted' USING ERRCODE='23514'; END IF;
      NEW.contextual_revision := OLD.contextual_revision + 1;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
