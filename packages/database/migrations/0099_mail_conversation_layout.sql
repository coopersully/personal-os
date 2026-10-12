ALTER TABLE "mail_workspace_settings"
  ADD COLUMN "mail_conversation_layout" text DEFAULT 'split' NOT NULL,
  ADD CONSTRAINT "mail_workspace_settings_layout_check" CHECK ("mail_conversation_layout" IN ('split', 'single'));
