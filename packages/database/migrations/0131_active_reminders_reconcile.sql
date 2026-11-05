-- Both 0124 histories were published independently. Keep their SQL and journal
-- identities intact. Main databases have already passed the older feature
-- timestamp, so this append-only migration also expands those databases.
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS active_reminder boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS active_reminder_preferences (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 default_active_reminder boolean NOT NULL DEFAULT false,
 revision integer NOT NULL CHECK (revision > 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS reminders_active_owner_due_idx ON reminders(user_id, due_at, id)
 WHERE active_reminder = true AND completed_at IS NULL AND deleted_at IS NULL;
