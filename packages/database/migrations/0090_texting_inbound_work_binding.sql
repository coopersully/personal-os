CREATE UNIQUE INDEX text_messages_owner_id_connection_idx ON text_messages(user_id, id, connection_id);
--> statement-breakpoint
CREATE TABLE text_inbound_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL,
  message_id uuid NOT NULL,
  consent_epoch integer NOT NULL CONSTRAINT text_inbound_claims_epoch_check CHECK (consent_epoch > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT text_inbound_claims_connection_fk FOREIGN KEY (user_id, connection_id) REFERENCES texting_connections(user_id, id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT text_inbound_claims_message_fk FOREIGN KEY (user_id, message_id, connection_id) REFERENCES text_messages(user_id, id, connection_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE UNIQUE INDEX text_inbound_claims_owner_id_idx ON text_inbound_claims(user_id, id);
CREATE UNIQUE INDEX text_inbound_claims_owner_id_connection_idx ON text_inbound_claims(user_id, id, connection_id);
CREATE UNIQUE INDEX text_inbound_claims_message_idx ON text_inbound_claims(message_id);
--> statement-breakpoint
CREATE TABLE text_reply_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL,
  outbound_message_id uuid NOT NULL,
  consent_epoch integer NOT NULL CONSTRAINT text_reply_bindings_epoch_check CHECK (consent_epoch > 0),
  item_number integer NOT NULL CONSTRAINT text_reply_bindings_item_check CHECK (item_number BETWEEN 1 AND 3),
  work_kind text NOT NULL,
  work_id uuid NOT NULL,
  work_revision text NOT NULL,
  action_revision text NOT NULL,
  answer_mode text NOT NULL,
  answer_vocabulary jsonb,
  expires_at timestamptz NOT NULL,
  operation_id uuid NOT NULL,
  inbound_claim_id uuid,
  canonical_answer text,
  state text NOT NULL DEFAULT 'open',
  result_revision text,
  reason_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT text_reply_bindings_connection_fk FOREIGN KEY (user_id, connection_id) REFERENCES texting_connections(user_id, id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT text_reply_bindings_outbound_fk FOREIGN KEY (user_id, outbound_message_id, connection_id) REFERENCES text_messages(user_id, id, connection_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT text_reply_bindings_claim_fk FOREIGN KEY (user_id, inbound_claim_id, connection_id) REFERENCES text_inbound_claims(user_id, id, connection_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT text_reply_bindings_work_check CHECK (work_kind IN ('question','approval','repair') AND length(work_revision) BETWEEN 1 AND 200 AND length(action_revision) BETWEEN 1 AND 200),
  CONSTRAINT text_reply_bindings_state_check CHECK (state IN ('open','expired','pending','waiting','uncertain','accepted','blocked','unavailable')),
  CONSTRAINT text_reply_bindings_mode_check CHECK ((answer_mode = 'choices' AND answer_vocabulary IS NOT NULL) OR (answer_mode = 'free_text' AND answer_vocabulary IS NULL)),
  CONSTRAINT text_reply_bindings_attachment_check CHECK (
    (state IN ('open','expired') AND inbound_claim_id IS NULL AND canonical_answer IS NULL AND result_revision IS NULL AND reason_code IS NULL)
    OR (state NOT IN ('open','expired') AND inbound_claim_id IS NOT NULL AND canonical_answer IS NOT NULL)
  ),
  CONSTRAINT text_reply_bindings_vocabulary_check CHECK (
    CASE WHEN answer_vocabulary IS NULL THEN answer_mode = 'free_text'
      WHEN jsonb_typeof(answer_vocabulary) = 'array'
      THEN jsonb_array_length(answer_vocabulary) BETWEEN 1 AND 8
      ELSE false END
  )
);
CREATE UNIQUE INDEX text_reply_bindings_owner_id_idx ON text_reply_bindings(user_id, id);
CREATE UNIQUE INDEX text_reply_bindings_operation_idx ON text_reply_bindings(user_id, operation_id);
CREATE UNIQUE INDEX text_reply_bindings_outbound_item_idx ON text_reply_bindings(user_id, outbound_message_id, item_number);
CREATE UNIQUE INDEX text_reply_bindings_inbound_item_idx ON text_reply_bindings(inbound_claim_id, item_number) WHERE inbound_claim_id IS NOT NULL;
CREATE INDEX text_reply_bindings_recovery_idx ON text_reply_bindings(state, updated_at);
--> statement-breakpoint
CREATE FUNCTION text_inbound_claims_reject_update() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Signed inbound claims are immutable' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER text_inbound_claims_immutable BEFORE UPDATE ON text_inbound_claims FOR EACH ROW EXECUTE FUNCTION text_inbound_claims_reject_update();
--> statement-breakpoint
CREATE FUNCTION text_inbound_claims_guard_delete() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.users WHERE id = OLD.user_id) THEN
    RAISE EXCEPTION 'Inbound claims remain until owner deletion' USING ERRCODE='23514';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER text_inbound_claims_guard_delete BEFORE DELETE ON text_inbound_claims FOR EACH ROW EXECUTE FUNCTION text_inbound_claims_guard_delete();
--> statement-breakpoint
CREATE FUNCTION text_reply_bindings_guard_update() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF ROW(NEW.id, NEW.user_id, NEW.connection_id, NEW.outbound_message_id, NEW.consent_epoch,
         NEW.item_number, NEW.work_kind, NEW.work_id, NEW.work_revision, NEW.action_revision,
         NEW.answer_mode, NEW.answer_vocabulary, NEW.expires_at, NEW.operation_id, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.user_id, OLD.connection_id, OLD.outbound_message_id, OLD.consent_epoch,
         OLD.item_number, OLD.work_kind, OLD.work_id, OLD.work_revision, OLD.action_revision,
         OLD.answer_mode, OLD.answer_vocabulary, OLD.expires_at, OLD.operation_id, OLD.created_at) THEN
    RAISE EXCEPTION 'Reply binding evidence is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.state IN ('expired','accepted','blocked','unavailable')
     OR (OLD.state = 'open' AND NOT (
           (NEW.state = 'pending' AND NEW.inbound_claim_id IS NOT NULL AND NEW.canonical_answer IS NOT NULL)
           OR (NEW.state = 'expired' AND CURRENT_TIMESTAMP >= OLD.expires_at
               AND NEW.inbound_claim_id IS NULL AND NEW.canonical_answer IS NULL)))
     OR (OLD.state NOT IN ('open','expired') AND (NEW.inbound_claim_id IS DISTINCT FROM OLD.inbound_claim_id
         OR NEW.canonical_answer IS DISTINCT FROM OLD.canonical_answer))
     OR (OLD.state = 'pending' AND NEW.state NOT IN ('waiting','uncertain','accepted','blocked','unavailable'))
     OR (OLD.state IN ('waiting','uncertain') AND NEW.state NOT IN ('pending','waiting','uncertain','accepted','blocked','unavailable')) THEN
    RAISE EXCEPTION 'Invalid reply binding transition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER text_reply_bindings_guard_update BEFORE UPDATE ON text_reply_bindings FOR EACH ROW EXECUTE FUNCTION text_reply_bindings_guard_update();
--> statement-breakpoint
CREATE FUNCTION text_reply_bindings_guard_delete() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF OLD.state IN ('open','pending','waiting','uncertain')
     AND EXISTS (SELECT 1 FROM public.users WHERE id = OLD.user_id) THEN
    RAISE EXCEPTION 'Unfinished reply binding cannot be deleted' USING ERRCODE='23514';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER text_reply_bindings_guard_delete BEFORE DELETE ON text_reply_bindings FOR EACH ROW EXECUTE FUNCTION text_reply_bindings_guard_delete();
