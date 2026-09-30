CREATE TABLE "desktop_mail_state" (
  "account_id" uuid PRIMARY KEY REFERENCES "calendar_accounts"("id") ON DELETE CASCADE,
  "established_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "desktop_mail_activity" (
  "sequence" bigserial PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "account_id" uuid NOT NULL REFERENCES "calendar_accounts"("id") ON DELETE CASCADE,
  "remote_message_id" text NOT NULL,
  "thread_id" uuid NOT NULL REFERENCES "mail_threads"("id") ON DELETE CASCADE,
  "received_at" timestamp with time zone NOT NULL,
  "eligible" boolean NOT NULL DEFAULT false
);
--> statement-breakpoint
CREATE UNIQUE INDEX "desktop_mail_activity_remote_idx" ON "desktop_mail_activity" ("account_id", "remote_message_id");
--> statement-breakpoint
CREATE INDEX "desktop_mail_activity_user_sequence_idx" ON "desktop_mail_activity" ("user_id", "sequence");
