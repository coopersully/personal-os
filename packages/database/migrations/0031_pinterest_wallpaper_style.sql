ALTER TABLE "pinterest_connections" ADD COLUMN IF NOT EXISTS "background_color" text DEFAULT '#ffffff' NOT NULL;
ALTER TABLE "pinterest_connections" ADD COLUMN IF NOT EXISTS "background_mode" text DEFAULT 'white' NOT NULL;
ALTER TABLE "pinterest_connections" ADD COLUMN IF NOT EXISTS "corner_radius" integer DEFAULT 0 NOT NULL;
ALTER TABLE "pinterest_connections" ADD COLUMN IF NOT EXISTS "padding_bottom" integer DEFAULT 16 NOT NULL;
ALTER TABLE "pinterest_connections" ADD COLUMN IF NOT EXISTS "padding_end" integer DEFAULT 16 NOT NULL;
ALTER TABLE "pinterest_connections" ADD COLUMN IF NOT EXISTS "padding_linked" boolean DEFAULT true NOT NULL;
ALTER TABLE "pinterest_connections" ADD COLUMN IF NOT EXISTS "padding_start" integer DEFAULT 16 NOT NULL;
ALTER TABLE "pinterest_connections" ADD COLUMN IF NOT EXISTS "padding_top" integer DEFAULT 16 NOT NULL;
