CREATE TABLE "mail_drafts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "account_id" uuid NOT NULL REFERENCES "calendar_accounts"("id") ON DELETE cascade,
  "thread_id" uuid REFERENCES "mail_threads"("id") ON DELETE set null,
  "subject" text DEFAULT '' NOT NULL,
  "body" text DEFAULT '' NOT NULL,
  "to_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "cc_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "sent_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "mail_drafts_user_updated_idx" ON "mail_drafts" USING btree ("user_id", "updated_at");
CREATE TABLE "mail_snoozes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "thread_id" uuid NOT NULL REFERENCES "mail_threads"("id") ON DELETE cascade,
  "until" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "mail_snoozes_thread_idx" ON "mail_snoozes" USING btree ("thread_id");
CREATE INDEX "mail_snoozes_until_idx" ON "mail_snoozes" USING btree ("until");
CREATE TABLE "mail_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "query" text NOT NULL,
  "action" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "mail_rules_user_idx" ON "mail_rules" USING btree ("user_id");
