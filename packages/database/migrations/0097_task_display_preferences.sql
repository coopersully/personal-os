ALTER TABLE "tasks_workspace_settings"
  ADD COLUMN "task_sort" text DEFAULT 'default' NOT NULL,
  ADD COLUMN "task_group" text DEFAULT 'none' NOT NULL,
  ADD COLUMN "task_row_details" text[] DEFAULT ARRAY['estimate']::text[] NOT NULL,
  ADD COLUMN "task_container_sort" text DEFAULT 'updated' NOT NULL,
  ADD CONSTRAINT "tasks_workspace_settings_sort_check" CHECK ("task_sort" IN ('default', 'date', 'reserved', 'priority', 'newest', 'oldest', 'title', 'estimate')),
  ADD CONSTRAINT "tasks_workspace_settings_group_check" CHECK ("task_group" IN ('none', 'date', 'list', 'project')),
  ADD CONSTRAINT "tasks_workspace_settings_details_check" CHECK ("task_row_details" <@ ARRAY['estimate', 'tags', 'notes']::text[] AND cardinality("task_row_details") <= 3),
  ADD CONSTRAINT "tasks_workspace_settings_container_sort_check" CHECK ("task_container_sort" IN ('updated', 'name', 'newest', 'target'));
