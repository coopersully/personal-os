CREATE TABLE "goals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "title" text NOT NULL,
  "description" text,
  "status" text DEFAULT 'active' NOT NULL,
  "progress" integer DEFAULT 0 NOT NULL,
  "target_date" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "goals_user_status_idx" ON "goals" USING btree ("user_id", "status", "target_date");
CREATE TABLE "motives" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "title" text NOT NULL,
  "detail" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "motives_user_active_idx" ON "motives" USING btree ("user_id", "is_active");
