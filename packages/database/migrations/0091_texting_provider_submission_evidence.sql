ALTER TABLE text_messages ADD COLUMN provider_submitted_at timestamptz;
ALTER TABLE text_messages ADD CONSTRAINT text_messages_provider_submitted_check CHECK (
  provider_submitted_at IS NULL OR (direction = 'outbound' AND provider_message_sid IS NOT NULL)
);
--> statement-breakpoint
CREATE FUNCTION text_messages_guard_provider_submitted_update() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF OLD.provider_message_sid IS NOT NULL AND NEW.provider_message_sid IS NULL AND
     NEW.status <> 'unknown' THEN
    RAISE EXCEPTION 'A provider SID may only be cleared for uncertain delivery' USING ERRCODE='23514';
  END IF;
  IF OLD.provider_submitted_at IS NULL AND NEW.provider_submitted_at IS NOT NULL AND
     (OLD.provider_message_sid IS NOT NULL OR OLD.status <> 'queued' OR
      NEW.status NOT IN ('queued','accepted')) THEN
    RAISE EXCEPTION 'Provider submission time requires a queued first provider handoff' USING ERRCODE='23514';
  END IF;
  IF OLD.provider_submitted_at IS NOT NULL AND
     (NEW.provider_submitted_at IS DISTINCT FROM OLD.provider_submitted_at OR
      NEW.provider_message_sid IS DISTINCT FROM OLD.provider_message_sid) THEN
    RAISE EXCEPTION 'Provider submission evidence is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER text_messages_provider_submitted_immutable BEFORE UPDATE ON text_messages FOR EACH ROW EXECUTE FUNCTION text_messages_guard_provider_submitted_update();
