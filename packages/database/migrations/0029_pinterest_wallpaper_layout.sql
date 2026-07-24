ALTER TABLE "pinterest_connections" ADD COLUMN IF NOT EXISTS "layout" text DEFAULT 'grid' NOT NULL;
ALTER TABLE "pinterest_connections" ADD COLUMN IF NOT EXISTS "rotation_degrees" integer DEFAULT 0 NOT NULL;
ALTER TABLE "pinterest_connections" ADD COLUMN IF NOT EXISTS "tile_size" integer DEFAULT 64 NOT NULL;
