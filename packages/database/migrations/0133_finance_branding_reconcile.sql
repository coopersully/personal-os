-- Both 0131 histories were published independently. Active-card preview databases
-- can already be beyond the Finance branding timestamp, so expand them here.
-- Preserve both published migrations/journal identities and all existing metadata.
ALTER TABLE "finance_provider_items" ADD COLUMN IF NOT EXISTS "institution_id" text;
--> statement-breakpoint
ALTER TABLE "finance_provider_items" ADD COLUMN IF NOT EXISTS "institution_branding" jsonb;
--> statement-breakpoint
ALTER TABLE "finance_provider_items" ADD COLUMN IF NOT EXISTS "branding_next_refresh_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "finance_provider_items" ADD COLUMN IF NOT EXISTS "branding_failure_code" text;
