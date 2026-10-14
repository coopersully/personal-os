CREATE TABLE "today_settings" (
  "user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "background" text DEFAULT 'default' NOT NULL,
  "show_spending" boolean DEFAULT false NOT NULL,
  "show_ritual" boolean DEFAULT false NOT NULL,
  "show_pet" boolean DEFAULT true NOT NULL,
  "spending_window" text DEFAULT 'week' NOT NULL,
  "commitment_filter" text DEFAULT 'all' NOT NULL,
  "include_undated" boolean DEFAULT false NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "today_settings_background_check" CHECK ("background" IN ('default', 'weather', 'map')),
  CONSTRAINT "today_settings_window_check" CHECK ("spending_window" IN ('week', 'month')),
  CONSTRAINT "today_settings_filter_check" CHECK ("commitment_filter" IN ('all', 'overdue', 'tasks', 'reminders')),
  CONSTRAINT "today_settings_revision_check" CHECK ("revision" > 0)
);
