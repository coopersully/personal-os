CREATE TABLE "finance_review_batch_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "actor_type" text NOT NULL,
  "actor_id" text NOT NULL,
  "authorization_connection_id" uuid,
  "idempotency_key" text NOT NULL,
  "fingerprint" text NOT NULL,
  "manifest" jsonb NOT NULL,
  "outcomes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "finance_review_batch_runs_actor_check" CHECK ("actor_type" IN ('user', 'agent')),
  CONSTRAINT "finance_review_batch_runs_manifest_check" CHECK (jsonb_typeof("manifest") = 'array' AND jsonb_array_length("manifest") BETWEEN 1 AND 100),
  CONSTRAINT "finance_review_batch_runs_outcomes_check" CHECK (jsonb_typeof("outcomes") = 'array' AND jsonb_array_length("outcomes") <= jsonb_array_length("manifest"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_review_batch_runs_owner_key_unique" ON "finance_review_batch_runs" ("user_id", "idempotency_key");
--> statement-breakpoint
CREATE INDEX "finance_review_batch_runs_owner_created_idx" ON "finance_review_batch_runs" ("user_id", "created_at", "id");
