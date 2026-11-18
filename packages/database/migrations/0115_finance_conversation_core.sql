CREATE TABLE finance_conversations (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 next_sequence bigint NOT NULL DEFAULT 0,
 CONSTRAINT finance_conversations_sequence_check CHECK (next_sequence >= 0)
);
CREATE TABLE finance_conversation_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 sequence bigint NOT NULL, author_kind text NOT NULL, text text NOT NULL, case_id uuid, case_owner_id uuid,
 record_refs jsonb NOT NULL DEFAULT '[]', source_message_ids jsonb NOT NULL DEFAULT '[]', run_id uuid,
 source_operation_id uuid, idempotency_key text NOT NULL, created_at timestamptz NOT NULL,
 CONSTRAINT finance_conversation_messages_case_fk FOREIGN KEY(case_owner_id, case_id) REFERENCES finance_review_cases(user_id,id) ON DELETE SET NULL,
 CONSTRAINT finance_conversation_messages_run_fk FOREIGN KEY(run_id,user_id) REFERENCES workspace_maintenance_runs(id,user_id),
 CONSTRAINT finance_conversation_messages_case_owner_check CHECK ((case_id IS NULL AND case_owner_id IS NULL) OR (case_id IS NOT NULL AND case_owner_id IS NOT NULL AND case_owner_id = user_id)),
 CONSTRAINT finance_conversation_messages_sequence_check CHECK(sequence > 0),
 CONSTRAINT finance_conversation_messages_author_check CHECK(author_kind IN ('user','agent')),
 CONSTRAINT finance_conversation_messages_text_check CHECK(length(btrim(text)) BETWEEN 1 AND 10000)
);
CREATE UNIQUE INDEX finance_conversation_messages_owner_id_idx ON finance_conversation_messages(user_id,id);
CREATE UNIQUE INDEX finance_conversation_messages_operation_idx ON finance_conversation_messages(user_id,source_operation_id);
CREATE UNIQUE INDEX finance_conversation_messages_sequence_idx ON finance_conversation_messages(user_id,sequence);
CREATE UNIQUE INDEX finance_conversation_messages_idempotency_idx ON finance_conversation_messages(user_id,author_kind,idempotency_key);
--> statement-breakpoint
CREATE TABLE finance_conversation_batches (
 run_id uuid PRIMARY KEY, user_id uuid NOT NULL, automation_schedule_id uuid, authorization_connection_id uuid,
 cursor_key text NOT NULL, cutoff_sequence bigint NOT NULL, captured_at timestamptz NOT NULL,
 CONSTRAINT finance_conversation_batches_run_fk FOREIGN KEY(run_id,user_id) REFERENCES workspace_maintenance_runs(id,user_id) ON DELETE CASCADE,
 CONSTRAINT finance_conversation_batches_schedule_fk FOREIGN KEY(user_id,automation_schedule_id) REFERENCES automation_host_schedules(user_id,id),
 CONSTRAINT finance_conversation_batches_cutoff_check CHECK(cutoff_sequence >= 0),
 CONSTRAINT finance_conversation_batches_binding_check CHECK((automation_schedule_id IS NULL) = (authorization_connection_id IS NULL))
);
CREATE UNIQUE INDEX finance_conversation_batches_owner_run_idx ON finance_conversation_batches(user_id,run_id);
CREATE TABLE finance_conversation_batch_messages (
 user_id uuid NOT NULL, run_id uuid NOT NULL, message_id uuid NOT NULL, delivered_at timestamptz, acknowledged_at timestamptz,
 PRIMARY KEY(user_id,run_id,message_id),
 CONSTRAINT finance_conversation_batch_messages_batch_fk FOREIGN KEY(user_id,run_id) REFERENCES finance_conversation_batches(user_id,run_id) ON DELETE CASCADE,
 CONSTRAINT finance_conversation_batch_messages_message_fk FOREIGN KEY(user_id,message_id) REFERENCES finance_conversation_messages(user_id,id),
 CONSTRAINT finance_conversation_batch_messages_ack_check CHECK(acknowledged_at IS NULL OR (delivered_at IS NOT NULL AND acknowledged_at >= delivered_at))
);
CREATE UNIQUE INDEX finance_conversation_batch_messages_once_idx ON finance_conversation_batch_messages(user_id,message_id);
CREATE TABLE finance_conversation_read_cursors (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, read_through_sequence bigint NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL,
 CONSTRAINT finance_conversation_read_cursors_sequence_check CHECK(read_through_sequence >= 0)
);
--> statement-breakpoint
CREATE TABLE finance_conversation_capabilities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, automation_schedule_id uuid NOT NULL,
 authorization_connection_id uuid NOT NULL, protocol_version text NOT NULL, nonce_digest text NOT NULL, challenge_text text NOT NULL,
 expires_at timestamptz NOT NULL, fetched_at timestamptz, acknowledged_at timestamptz, responded_at timestamptz,
 verified_at timestamptz, response text, created_at timestamptz NOT NULL,
 CONSTRAINT finance_conversation_capabilities_schedule_fk FOREIGN KEY(user_id,automation_schedule_id) REFERENCES automation_host_schedules(user_id,id) ON DELETE CASCADE,
 CONSTRAINT finance_conversation_capabilities_proof_check CHECK((acknowledged_at IS NULL OR fetched_at IS NOT NULL) AND (responded_at IS NULL OR acknowledged_at IS NOT NULL) AND (verified_at IS NULL OR (responded_at IS NOT NULL AND response IS NOT NULL)))
);
CREATE INDEX finance_conversation_capabilities_binding_idx ON finance_conversation_capabilities(user_id,automation_schedule_id,authorization_connection_id,protocol_version);
CREATE TABLE finance_conversation_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, run_id uuid NOT NULL, case_id uuid, case_owner_id uuid, source_context jsonb NOT NULL,
 action_key text NOT NULL, source_operation_id uuid, source_message_ids jsonb NOT NULL,
 explanation text NOT NULL, effect_refs jsonb NOT NULL, created_at timestamptz NOT NULL,
 CONSTRAINT finance_conversation_evidence_batch_fk FOREIGN KEY(user_id,run_id) REFERENCES finance_conversation_batches(user_id,run_id) ON DELETE CASCADE,
 CONSTRAINT finance_conversation_evidence_case_fk FOREIGN KEY(case_owner_id,case_id) REFERENCES finance_review_cases(user_id,id) ON DELETE SET NULL,
 CONSTRAINT finance_conversation_evidence_case_owner_check CHECK ((case_id IS NULL AND case_owner_id IS NULL) OR (case_id IS NOT NULL AND case_owner_id IS NOT NULL AND case_owner_id = user_id)),
 CONSTRAINT finance_conversation_evidence_explanation_check CHECK(length(btrim(explanation)) BETWEEN 1 AND 4000)
);
CREATE UNIQUE INDEX finance_conversation_evidence_action_idx ON finance_conversation_evidence(user_id,action_key);
CREATE UNIQUE INDEX finance_conversation_evidence_operation_idx ON finance_conversation_evidence(user_id,source_operation_id);
--> statement-breakpoint
CREATE FUNCTION finance_conversation_reject_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME IN ('finance_conversation_messages', 'finance_conversation_evidence') AND pg_trigger_depth() > 1 THEN
  IF OLD.case_id IS NOT NULL AND OLD.case_owner_id IS NOT NULL AND NEW.case_id IS NULL AND NEW.case_owner_id IS NULL
   AND (to_jsonb(NEW) - 'case_id' - 'case_owner_id') = (to_jsonb(OLD) - 'case_id' - 'case_owner_id') THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Finance conversation messages, batches and evidence are immutable';
END;
$$;
CREATE TRIGGER finance_conversation_messages_immutable BEFORE UPDATE ON finance_conversation_messages FOR EACH ROW EXECUTE FUNCTION finance_conversation_reject_update();
CREATE TRIGGER finance_conversation_batches_immutable BEFORE UPDATE ON finance_conversation_batches FOR EACH ROW EXECUTE FUNCTION finance_conversation_reject_update();
CREATE TRIGGER finance_conversation_evidence_immutable BEFORE UPDATE ON finance_conversation_evidence FOR EACH ROW EXECUTE FUNCTION finance_conversation_reject_update();
