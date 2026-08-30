ALTER TABLE "users" ADD COLUMN "setup_status" text DEFAULT 'dismissed' NOT NULL;
ALTER TABLE "users" ADD COLUMN "setup_current_step" text DEFAULT 'welcome' NOT NULL;
ALTER TABLE "users" ADD COLUMN "setup_selected_workspaces" jsonb DEFAULT '["calendar","tasks","mail","finances"]'::jsonb NOT NULL;
ALTER TABLE "users" ADD COLUMN "setup_started_at" timestamp with time zone;
ALTER TABLE "users" ADD COLUMN "setup_completed_at" timestamp with time zone;
ALTER TABLE "users" ADD COLUMN "setup_dismissed_at" timestamp with time zone;
ALTER TABLE "oauth_states" ADD COLUMN "requested_services" jsonb;
ALTER TABLE "oauth_states" ADD COLUMN "return_path" text;
