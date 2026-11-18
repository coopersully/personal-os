-- Additive display metadata; existing rows acquire it during normal fenced sync.
ALTER TABLE "finance_provider_items" ADD COLUMN "institution_id" text;
--> statement-breakpoint
ALTER TABLE "finance_provider_items" ADD COLUMN "institution_branding" jsonb;
--> statement-breakpoint
ALTER TABLE "finance_provider_items" ADD COLUMN "branding_next_refresh_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "finance_provider_items" ADD COLUMN "branding_failure_code" text;
