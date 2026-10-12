CREATE TABLE finance_sms_completions (
 claim_id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 connection_id uuid NOT NULL,
 disposition text NOT NULL CONSTRAINT finance_sms_completions_disposition_check CHECK (disposition IN ('answer_received','context_captured','clarification_required')),
 context_id uuid,
 acknowledgement_message_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT finance_sms_completions_claim_fk FOREIGN KEY (user_id,claim_id,connection_id) REFERENCES text_inbound_claims(user_id,id,connection_id) ON DELETE CASCADE,
 CONSTRAINT finance_sms_completions_context_fk FOREIGN KEY (user_id,context_id) REFERENCES finance_contexts(user_id,id),
 CONSTRAINT finance_sms_completions_ack_fk FOREIGN KEY (user_id,acknowledgement_message_id,connection_id) REFERENCES text_messages(user_id,id,connection_id),
 CONSTRAINT finance_sms_completions_context_check CHECK ((disposition='context_captured')=(context_id IS NOT NULL))
);
--> statement-breakpoint
CREATE FUNCTION finance_sms_completions_guard_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.claim_id,NEW.user_id,NEW.connection_id,NEW.disposition,NEW.context_id,NEW.created_at) IS DISTINCT FROM (OLD.claim_id,OLD.user_id,OLD.connection_id,OLD.disposition,OLD.context_id,OLD.created_at)
 OR (OLD.acknowledgement_message_id IS NOT NULL AND NEW.acknowledgement_message_id IS DISTINCT FROM OLD.acknowledgement_message_id)
 THEN RAISE EXCEPTION 'Finance SMS completion evidence is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER finance_sms_completions_guard_update BEFORE UPDATE ON finance_sms_completions FOR EACH ROW EXECUTE FUNCTION finance_sms_completions_guard_update();
--> statement-breakpoint
ALTER TABLE finance_context_revisions DROP CONSTRAINT finance_context_revisions_source_check;
--> statement-breakpoint
ALTER TABLE finance_context_revisions ADD CONSTRAINT finance_context_revisions_source_check CHECK (source_kind IN ('app','agent','sms','expiry'));
--> statement-breakpoint
ALTER TABLE finance_context_revisions DROP CONSTRAINT finance_context_revisions_provenance_check;
--> statement-breakpoint
ALTER TABLE finance_context_revisions ADD CONSTRAINT finance_context_revisions_provenance_check CHECK ((source_kind IN ('app','sms') AND actor_type='user') OR (source_kind='agent' AND actor_type='agent') OR (source_kind='expiry' AND actor_type='system' AND actor_id='finance-context-expiry'));

--> statement-breakpoint
CREATE FUNCTION finance_sms_completions_guard_delete() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM public.users WHERE id=OLD.user_id) THEN
  RAISE EXCEPTION 'Finance SMS completion evidence remains until owner deletion' USING ERRCODE='23514';
 END IF;
 RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER finance_sms_completions_guard_delete BEFORE DELETE ON finance_sms_completions FOR EACH ROW EXECUTE FUNCTION finance_sms_completions_guard_delete();
