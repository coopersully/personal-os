ALTER TABLE "tasks_workspace_settings"
  ADD COLUMN "default_capture_list_id" uuid,
  ADD COLUMN "show_completed_tasks" boolean NOT NULL DEFAULT false;
