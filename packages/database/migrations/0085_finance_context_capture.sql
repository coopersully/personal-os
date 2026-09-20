CREATE FUNCTION finance_context_participants_valid(value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE item jsonb; label text;
BEGIN
  IF value IS NULL OR jsonb_typeof(value) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(value) > 50 THEN RETURN false; END IF;
  FOR item IN SELECT jsonb_array_elements(value) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
    label := item #>> '{}';
    IF label IS NULL OR label <> btrim(label) OR char_length(label) NOT BETWEEN 1 AND 200 THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$$;
--> statement-breakpoint
CREATE TABLE finance_contexts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  current_revision bigint NOT NULL CONSTRAINT finance_contexts_revision_check CHECK(current_revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX finance_contexts_user_id_unique ON finance_contexts(user_id,id);
CREATE INDEX finance_contexts_user_updated_idx ON finance_contexts(user_id,updated_at,id);
--> statement-breakpoint
CREATE TABLE finance_context_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  context_id uuid NOT NULL,
  revision bigint NOT NULL CONSTRAINT finance_context_revisions_revision_check CHECK(revision > 0),
  text text NOT NULL CONSTRAINT finance_context_revisions_text_check CHECK(char_length(text) BETWEEN 1 AND 10000 AND text=btrim(text)),
  valid_from timestamptz,
  valid_through timestamptz,
  participants jsonb NOT NULL DEFAULT '[]'::jsonb CONSTRAINT finance_context_revisions_participants_check CHECK(COALESCE(finance_context_participants_valid(participants), false)),
  payment_channel text CONSTRAINT finance_context_revisions_payment_check CHECK(payment_channel IS NULL OR (char_length(payment_channel) BETWEEN 1 AND 100 AND payment_channel=btrim(payment_channel))),
  expected_cents bigint CONSTRAINT finance_context_revisions_cents_check CHECK(expected_cents IS NULL OR expected_cents BETWEEN -9007199254740991 AND 9007199254740991),
  category_id uuid CONSTRAINT finance_context_revisions_category_check CHECK(category_id IS NULL),
  transaction_ids jsonb NOT NULL DEFAULT '[]'::jsonb CONSTRAINT finance_context_revisions_transactions_check CHECK(transaction_ids='[]'::jsonb),
  status text NOT NULL CONSTRAINT finance_context_revisions_status_check CHECK(status IN ('active','expired','cancelled')),
  source_kind text NOT NULL CONSTRAINT finance_context_revisions_source_check CHECK(source_kind IN ('app','agent','expiry')),
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  request_id text NOT NULL CONSTRAINT finance_context_revisions_request_check CHECK(char_length(request_id) BETWEEN 1 AND 240),
  operation_id uuid,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT finance_context_revisions_window_check CHECK(valid_from IS NULL OR valid_through IS NULL OR valid_from<=valid_through),
  CONSTRAINT finance_context_revisions_actor_check CHECK(actor_type IN ('user','agent','system') AND char_length(actor_id) BETWEEN 1 AND 240),
  CONSTRAINT finance_context_revisions_operation_check CHECK((source_kind='expiry')=(operation_id IS NULL)),
  CONSTRAINT finance_context_revisions_provenance_check CHECK((source_kind='app' AND actor_type='user') OR (source_kind='agent' AND actor_type='agent') OR (source_kind='expiry' AND actor_type='system' AND actor_id='finance-context-expiry')),
  CONSTRAINT finance_context_revisions_context_fk FOREIGN KEY(user_id,context_id) REFERENCES finance_contexts(user_id,id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
);
CREATE UNIQUE INDEX finance_context_revisions_user_context_revision_unique ON finance_context_revisions(user_id,context_id,revision);
--> statement-breakpoint
ALTER TABLE finance_contexts ADD CONSTRAINT finance_contexts_current_revision_fk FOREIGN KEY(user_id,id,current_revision) REFERENCES finance_context_revisions(user_id,context_id,revision) DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE FUNCTION finance_context_revisions_reject_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Finance context snapshots cannot be updated' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER finance_context_revisions_immutable_update BEFORE UPDATE ON finance_context_revisions FOR EACH ROW EXECUTE FUNCTION finance_context_revisions_reject_update();
