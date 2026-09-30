ALTER TABLE "mail_messages"
  ADD COLUMN "message_id" text,
  ADD COLUMN "references" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN "reply_to_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL;
