CREATE TABLE "x_bookmark_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "provider_account_id" text NOT NULL,
  "username" text NOT NULL,
  "display_name" text,
  "encrypted_credentials" jsonb NOT NULL,
  "selected_folder_id" text,
  "selected_folder_name" text,
  "sync_status" text DEFAULT 'idle' NOT NULL,
  "sync_error" text,
  "last_synced_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "x_bookmark_accounts_user_idx" ON "x_bookmark_accounts" ("user_id");
CREATE UNIQUE INDEX "x_bookmark_accounts_remote_idx" ON "x_bookmark_accounts" ("user_id", "provider_account_id");

CREATE TABLE "x_bookmark_folders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" uuid NOT NULL REFERENCES "x_bookmark_accounts"("id") ON DELETE cascade,
  "remote_folder_id" text NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "x_bookmark_folders_account_idx" ON "x_bookmark_folders" ("account_id");
CREATE UNIQUE INDEX "x_bookmark_folders_remote_idx" ON "x_bookmark_folders" ("account_id", "remote_folder_id");

CREATE TABLE "x_bookmarks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "account_id" uuid NOT NULL REFERENCES "x_bookmark_accounts"("id") ON DELETE cascade,
  "folder_id" uuid REFERENCES "x_bookmark_folders"("id") ON DELETE set null,
  "remote_post_id" text NOT NULL,
  "text" text NOT NULL,
  "author_id" text,
  "author_name" text,
  "author_username" text,
  "post_url" text NOT NULL,
  "posted_at" timestamp with time zone,
  "raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "synced_at" timestamp with time zone NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "x_bookmarks_user_synced_idx" ON "x_bookmarks" ("user_id", "synced_at");
CREATE INDEX "x_bookmarks_account_folder_idx" ON "x_bookmarks" ("account_id", "folder_id");
CREATE UNIQUE INDEX "x_bookmarks_remote_idx" ON "x_bookmarks" ("account_id", "remote_post_id");
