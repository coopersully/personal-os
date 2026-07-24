-- These columns shipped on the feature branch before the finance migration landed.
-- Keep this reconciliation migration safe for databases that followed either history.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "theme" text DEFAULT 'system' NOT NULL;
ALTER TABLE "calendar_accounts" ADD COLUMN IF NOT EXISTS "avatar_url" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "weather_location" text;
