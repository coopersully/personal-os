CREATE TABLE "mail_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "thread_id" uuid NOT NULL REFERENCES "mail_threads"("id") ON DELETE CASCADE,
  "remote_message_id" text NOT NULL,
  "body_text" text NOT NULL,
  "from_address" jsonb NOT NULL,
  "to_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "cc_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "received_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "mail_messages_remote_idx" ON "mail_messages" USING btree ("thread_id","remote_message_id");
