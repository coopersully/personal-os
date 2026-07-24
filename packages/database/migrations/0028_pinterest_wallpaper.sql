CREATE TABLE IF NOT EXISTS "pinterest_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "board_url" text,
  "enabled" boolean DEFAULT false NOT NULL,
  "last_applied_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "pinterest_connections_user_idx" ON "pinterest_connections" USING btree ("user_id");
