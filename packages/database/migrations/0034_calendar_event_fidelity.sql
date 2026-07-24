ALTER TABLE "calendar_events"
  ADD COLUMN "event_type" text NOT NULL DEFAULT 'default',
  ADD COLUMN "transparency" text NOT NULL DEFAULT 'busy',
  ADD COLUMN "visibility" text NOT NULL DEFAULT 'default',
  ADD COLUMN "reminders" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "attendees" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "oauth_states" ADD COLUMN "encrypted_verifier" jsonb;
