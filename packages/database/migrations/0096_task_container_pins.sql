ALTER TABLE "tasks_workspace_settings"
  ADD COLUMN "pinned_list_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
  ADD COLUMN "pinned_project_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL;
