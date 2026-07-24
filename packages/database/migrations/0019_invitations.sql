CREATE TABLE "invitations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code_hash" text NOT NULL,
  "email" text,
  "created_by_user_id" uuid,
  "expires_at" timestamp with time zone NOT NULL,
  "redeemed_at" timestamp with time zone,
  "redeemed_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_redeemed_by_user_id_users_id_fk" FOREIGN KEY ("redeemed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_code_hash_idx" ON "invitations" USING btree ("code_hash");
--> statement-breakpoint
CREATE INDEX "invitations_created_by_user_idx" ON "invitations" USING btree ("created_by_user_id");
--> statement-breakpoint
CREATE INDEX "invitations_redeemable_idx" ON "invitations" USING btree ("redeemed_at", "expires_at");
