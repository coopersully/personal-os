CREATE UNIQUE INDEX finance_candidate_owner_run_revision_idx ON finance_maintenance_candidates(user_id,id,run_id,revision);
--> statement-breakpoint
CREATE TABLE finance_maintenance_execution_bindings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 run_id uuid NOT NULL,candidate_id uuid NOT NULL,candidate_revision text NOT NULL,
 submitted_from_revision text NOT NULL,submission_fingerprint text NOT NULL,
 original_actor_id uuid NOT NULL,current_actor_id uuid NOT NULL,binding_revision bigint NOT NULL DEFAULT 1,
 authorization_connection_id uuid NOT NULL,automation_schedule_id uuid NOT NULL,protocol_version text NOT NULL,
 created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,
 CONSTRAINT finance_execution_binding_revision_check CHECK(binding_revision>0),
 CONSTRAINT finance_execution_binding_candidate_fk FOREIGN KEY(user_id,candidate_id,run_id,candidate_revision) REFERENCES finance_maintenance_candidates(user_id,id,run_id,revision) DEFERRABLE INITIALLY DEFERRED,
 CONSTRAINT finance_execution_binding_original_actor_fk FOREIGN KEY(user_id,original_actor_id) REFERENCES access_tokens(user_id,id) DEFERRABLE INITIALLY DEFERRED,
 CONSTRAINT finance_execution_binding_current_actor_fk FOREIGN KEY(user_id,current_actor_id) REFERENCES access_tokens(user_id,id) DEFERRABLE INITIALLY DEFERRED,
 CONSTRAINT finance_execution_binding_schedule_fk FOREIGN KEY(user_id,automation_schedule_id) REFERENCES automation_host_schedules(user_id,id) DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE UNIQUE INDEX finance_execution_binding_owner_id_idx ON finance_maintenance_execution_bindings(user_id,id);
CREATE UNIQUE INDEX finance_execution_binding_candidate_idx ON finance_maintenance_execution_bindings(user_id,candidate_id,candidate_revision);
--> statement-breakpoint
CREATE TABLE finance_maintenance_execution_receipts (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,binding_id uuid NOT NULL,
 from_actor_id uuid NOT NULL,to_actor_id uuid NOT NULL,from_revision bigint NOT NULL,to_revision bigint NOT NULL,
 fingerprint text NOT NULL,created_at timestamptz NOT NULL,
 CONSTRAINT finance_execution_receipt_revision_check CHECK(from_revision>0 AND to_revision=from_revision+1),
 CONSTRAINT finance_execution_receipt_binding_fk FOREIGN KEY(user_id,binding_id) REFERENCES finance_maintenance_execution_bindings(user_id,id) DEFERRABLE INITIALLY DEFERRED,
 CONSTRAINT finance_execution_receipt_from_actor_fk FOREIGN KEY(user_id,from_actor_id) REFERENCES access_tokens(user_id,id) DEFERRABLE INITIALLY DEFERRED,
 CONSTRAINT finance_execution_receipt_to_actor_fk FOREIGN KEY(user_id,to_actor_id) REFERENCES access_tokens(user_id,id) DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE UNIQUE INDEX finance_execution_receipt_binding_revision_idx ON finance_maintenance_execution_receipts(user_id,binding_id,to_revision);
--> statement-breakpoint
CREATE FUNCTION guard_finance_execution_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Finance execution receipts are immutable';
END $$;
CREATE TRIGGER finance_execution_receipt_immutable BEFORE UPDATE OR DELETE ON finance_maintenance_execution_receipts FOR EACH ROW EXECUTE FUNCTION guard_finance_execution_receipt();
--> statement-breakpoint
CREATE FUNCTION guard_finance_execution_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Finance execution attribution is immutable';
 END IF;
 IF (to_jsonb(NEW)-'current_actor_id'-'binding_revision'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'current_actor_id'-'binding_revision'-'updated_at')
 OR NEW.binding_revision<>OLD.binding_revision+1
 OR NEW.current_actor_id=OLD.current_actor_id
 OR NOT EXISTS(SELECT 1 FROM finance_maintenance_execution_receipts r WHERE r.user_id=OLD.user_id AND r.binding_id=OLD.id AND r.from_actor_id=OLD.current_actor_id AND r.to_actor_id=NEW.current_actor_id AND r.from_revision=OLD.binding_revision AND r.to_revision=NEW.binding_revision)
 THEN RAISE EXCEPTION 'Finance execution refresh requires its exact causal receipt'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER finance_execution_binding_guard BEFORE UPDATE OR DELETE ON finance_maintenance_execution_bindings FOR EACH ROW EXECUTE FUNCTION guard_finance_execution_binding();

--> statement-breakpoint
-- Prospective canonical proof order only. Historical proofs remain NULL; never guess a generation.
ALTER TABLE finance_conversation_capabilities ADD COLUMN generation bigint;
ALTER TABLE finance_conversation_capabilities ADD CONSTRAINT finance_conversation_capabilities_generation_check CHECK(generation IS NULL OR generation>0);
CREATE UNIQUE INDEX finance_conversation_capabilities_generation_idx ON finance_conversation_capabilities(user_id,automation_schedule_id,authorization_connection_id,protocol_version,generation) WHERE generation IS NOT NULL;

--> statement-breakpoint
CREATE FUNCTION guard_finance_proof_generation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) OR NOT EXISTS(SELECT 1 FROM automation_host_schedules WHERE user_id=OLD.user_id AND id=OLD.automation_schedule_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Finance proof generations cannot be deleted while their owner and registration remain';
 END IF;
 IF (to_jsonb(NEW)-'fetched_at'-'acknowledged_at'-'responded_at'-'verified_at'-'response') IS DISTINCT FROM (to_jsonb(OLD)-'fetched_at'-'acknowledged_at'-'responded_at'-'verified_at'-'response') THEN
  RAISE EXCEPTION 'Finance proof generation and original challenge are immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER finance_proof_generation_guard BEFORE UPDATE OR DELETE ON finance_conversation_capabilities FOR EACH ROW EXECUTE FUNCTION guard_finance_proof_generation();
