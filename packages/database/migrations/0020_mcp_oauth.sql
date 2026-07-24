ALTER TABLE "access_tokens" ADD COLUMN "audience" text;--> statement-breakpoint
ALTER TABLE "access_tokens" ADD COLUMN "client_id" text;--> statement-breakpoint
CREATE TABLE "oauth_clients" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "redirect_uris" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "oauth_authorization_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" text NOT NULL,
  "code_challenge" text NOT NULL,
  "code_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "redirect_uri" text NOT NULL,
  "resource" text NOT NULL,
  "scopes" jsonb NOT NULL,
  "used_at" timestamp with time zone,
  "user_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "oauth_authorization_codes_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "oauth_clients"("id") ON DELETE cascade,
  CONSTRAINT "oauth_authorization_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_authorization_codes_hash_idx" ON "oauth_authorization_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE TABLE "oauth_refresh_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "access_token_id" uuid NOT NULL,
  "client_id" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "replaced_at" timestamp with time zone,
  "token_hash" text NOT NULL,
  "user_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "oauth_refresh_tokens_access_token_id_access_tokens_id_fk" FOREIGN KEY ("access_token_id") REFERENCES "access_tokens"("id") ON DELETE cascade,
  CONSTRAINT "oauth_refresh_tokens_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "oauth_clients"("id") ON DELETE cascade,
  CONSTRAINT "oauth_refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_refresh_tokens_hash_idx" ON "oauth_refresh_tokens" USING btree ("token_hash");
