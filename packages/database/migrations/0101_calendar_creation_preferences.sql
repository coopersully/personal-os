ALTER TABLE "calendar_workspace_settings"
  ADD COLUMN "week_starts_on" text NOT NULL DEFAULT 'sunday',
  ADD COLUMN "default_event_duration_minutes" integer NOT NULL DEFAULT 60,
  ADD CONSTRAINT "calendar_workspace_settings_week_start_check" CHECK ("week_starts_on" IN ('sunday', 'monday')),
  ADD CONSTRAINT "calendar_workspace_settings_duration_check" CHECK ("default_event_duration_minutes" BETWEEN 5 AND 1440);
