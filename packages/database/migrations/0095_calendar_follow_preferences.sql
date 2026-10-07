ALTER TABLE "calendar_workspace_settings"
  ADD COLUMN "auto_follow_today" boolean DEFAULT true NOT NULL,
  ADD COLUMN "snap_to_follow" boolean DEFAULT true NOT NULL,
  ADD COLUMN "follow_snap_sensitivity" text DEFAULT 'balanced' NOT NULL,
  ADD CONSTRAINT "calendar_workspace_settings_snap_check"
    CHECK ("follow_snap_sensitivity" IN ('precise', 'balanced', 'generous'));
