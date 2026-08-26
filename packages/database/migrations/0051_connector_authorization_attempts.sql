ALTER TABLE "oauth_states" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;
ALTER TABLE "oauth_states" ADD COLUMN "outcome_code" text;
ALTER TABLE "oauth_states" ADD COLUMN "connected_account_id" uuid;
ALTER TABLE "oauth_states" ADD COLUMN "redirect_uri" text;
ALTER TABLE "oauth_states" ADD COLUMN "completed_at" timestamptz;
ALTER TABLE "oauth_states" ADD COLUMN "request_id" text;
--> statement-breakpoint
UPDATE "oauth_states"
SET "status" = 'failed',
    "outcome_code" = 'legacy_consumed',
    "completed_at" = "consumed_at"
WHERE "consumed_at" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_status_check" CHECK (
  "status" IN ('pending', 'processing', 'connected', 'cancelled', 'expired', 'permission_incomplete', 'failed')
) NOT VALID;
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_lifecycle_check" CHECK (
  ("status" = 'pending' AND "consumed_at" IS NULL AND "completed_at" IS NULL)
  OR ("status" = 'processing' AND "consumed_at" IS NOT NULL AND "completed_at" IS NULL)
  OR (
    "status" IN ('connected', 'cancelled', 'expired', 'permission_incomplete', 'failed')
    AND "consumed_at" IS NOT NULL
    AND "completed_at" IS NOT NULL
  )
) NOT VALID;
--> statement-breakpoint
ALTER TABLE "oauth_states" VALIDATE CONSTRAINT "oauth_states_status_check";
ALTER TABLE "oauth_states" VALIDATE CONSTRAINT "oauth_states_lifecycle_check";
--> statement-breakpoint
CREATE INDEX "oauth_states_status_expiry_idx" ON "oauth_states" USING btree ("status", "expires_at");
CREATE INDEX "oauth_states_user_created_idx" ON "oauth_states" USING btree ("user_id", "created_at");
