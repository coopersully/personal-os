ALTER TABLE "mail_workspace_settings"
  ADD COLUMN "mail_list_density" text DEFAULT 'comfortable' NOT NULL,
  ADD COLUMN "mail_list_width" double precision DEFAULT 34 NOT NULL,
  ADD CONSTRAINT "mail_workspace_settings_density_check" CHECK ("mail_list_density" IN ('compact', 'comfortable', 'expanded')),
  ADD CONSTRAINT "mail_workspace_settings_width_check" CHECK ("mail_list_width" BETWEEN 5 AND 95);
