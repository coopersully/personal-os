ALTER TABLE "mail_drafts" ADD COLUMN "attachments" jsonb DEFAULT '[]'::jsonb NOT NULL;
