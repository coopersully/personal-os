CREATE TABLE "calendar_workspace_settings" (
  "user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "include_archived_in_search" boolean DEFAULT true NOT NULL,
  "calendar_view" text DEFAULT 'auto' NOT NULL,
  "show_weekends" boolean DEFAULT true NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "calendar_workspace_settings_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "calendar_workspace_settings_view_check" CHECK ("calendar_view" IN ('auto', 'day', 'week', 'month'))
);
--> statement-breakpoint
CREATE TABLE "tasks_workspace_settings" (
  "user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "include_archived_in_search" boolean DEFAULT true NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tasks_workspace_settings_revision_check" CHECK ("revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "mail_workspace_settings" (
  "user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "include_archived_in_search" boolean DEFAULT true NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "mail_workspace_settings_revision_check" CHECK ("revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "finances_workspace_settings" (
  "user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "include_archived_in_search" boolean DEFAULT true NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "finances_workspace_settings_revision_check" CHECK ("revision" > 0)
);
