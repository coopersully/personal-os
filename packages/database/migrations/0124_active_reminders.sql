ALTER TABLE reminders ADD COLUMN active_reminder boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE TABLE active_reminder_preferences (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 default_active_reminder boolean NOT NULL DEFAULT false,
 revision integer NOT NULL CHECK (revision > 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX reminders_active_owner_due_idx ON reminders(user_id, due_at, id)
 WHERE active_reminder = true AND completed_at IS NULL AND deleted_at IS NULL;
