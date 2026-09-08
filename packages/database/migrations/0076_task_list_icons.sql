ALTER TABLE "task_lists" ADD COLUMN "icon" text DEFAULT 'list' NOT NULL;
ALTER TABLE "task_lists" ADD CONSTRAINT "task_lists_icon_check" CHECK (
  "icon" IN ('list', 'home', 'star', 'target', 'calendar', 'wallet', 'people', 'receipt')
);
