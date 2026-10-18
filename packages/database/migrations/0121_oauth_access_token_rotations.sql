-- Prospective canonical OAuth evidence only. No inferred or historical edges.
CREATE UNIQUE INDEX access_tokens_owner_id_unique ON access_tokens(user_id,id);
--> statement-breakpoint
CREATE TABLE oauth_access_token_rotations (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 from_access_token_id uuid NOT NULL,
 to_access_token_id uuid PRIMARY KEY,
 client_id text NOT NULL,
 audience text NOT NULL,
 authorization_connection_id uuid NOT NULL,
 predecessor_scopes jsonb NOT NULL,
 successor_scopes jsonb NOT NULL,
 rotated_at timestamptz NOT NULL,
 CONSTRAINT oauth_rotation_distinct_actors CHECK (from_access_token_id <> to_access_token_id),
 CONSTRAINT oauth_rotation_predecessor_owner_fk FOREIGN KEY(user_id,from_access_token_id) REFERENCES access_tokens(user_id,id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
 CONSTRAINT oauth_rotation_successor_owner_fk FOREIGN KEY(user_id,to_access_token_id) REFERENCES access_tokens(user_id,id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE UNIQUE INDEX oauth_rotation_predecessor_unique ON oauth_access_token_rotations(from_access_token_id);
CREATE INDEX oauth_rotation_owner_successor_idx ON oauth_access_token_rotations(user_id,to_access_token_id);
--> statement-breakpoint
CREATE FUNCTION enforce_oauth_rotation_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE predecessor access_tokens%ROWTYPE; successor access_tokens%ROWTYPE;
BEGIN
 IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM users WHERE id=OLD.user_id) THEN RETURN OLD; END IF;
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'OAuth rotation evidence is immutable except for owner erasure' USING ERRCODE='23514'; END IF;
 SELECT * INTO predecessor FROM access_tokens WHERE id=NEW.from_access_token_id AND user_id=NEW.user_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'OAuth rotation predecessor is unavailable' USING ERRCODE='23514'; END IF;
 SELECT * INTO successor FROM access_tokens WHERE id=NEW.to_access_token_id AND user_id=NEW.user_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'OAuth rotation successor is unavailable' USING ERRCODE='23514'; END IF;
 IF predecessor.client_id IS DISTINCT FROM NEW.client_id OR successor.client_id IS DISTINCT FROM NEW.client_id
 OR predecessor.audience IS DISTINCT FROM NEW.audience OR successor.audience IS DISTINCT FROM NEW.audience
 OR predecessor.authorization_connection_id <> NEW.authorization_connection_id OR successor.authorization_connection_id <> NEW.authorization_connection_id
 OR predecessor.scopes IS DISTINCT FROM NEW.predecessor_scopes OR successor.scopes IS DISTINCT FROM NEW.successor_scopes
 OR NOT (NEW.successor_scopes <@ NEW.predecessor_scopes) OR predecessor.revoked_at IS NOT NULL OR successor.revoked_at IS NOT NULL THEN
  RAISE EXCEPTION 'OAuth rotation identities do not match canonical issuance' USING ERRCODE='23514';
 END IF;
 -- Fresh INSERT provenance is enforced by the private canonical issuer, not
 -- inferred from tuple xmin (which also changes on ordinary UPDATE).
 -- This guard validates immutable identity evidence, not arbitrary SQL authority.
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER oauth_rotation_evidence_guard BEFORE INSERT OR UPDATE OR DELETE ON oauth_access_token_rotations FOR EACH ROW EXECUTE FUNCTION enforce_oauth_rotation_evidence();
