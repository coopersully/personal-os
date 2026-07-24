ALTER TABLE "pinterest_connections" ADD COLUMN IF NOT EXISTS "mosaic_fit" text DEFAULT 'preserve' NOT NULL;
