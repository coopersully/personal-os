CREATE TABLE "agent_accounts" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
 "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
 "platform" text DEFAULT 'unknown' NOT NULL CHECK ("platform" IN ('claude','codex','other','unknown')),
 "display_name" text NOT NULL,
 "account_label" text,
 "avatar_seed" uuid DEFAULT gen_random_uuid() NOT NULL,
 "avatar_version" integer DEFAULT 1 NOT NULL CHECK ("avatar_version" = 1),
 "identity_source" text DEFAULT 'connection' NOT NULL CHECK ("identity_source" IN ('connection','user_confirmed')),
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "agent_accounts_owner_unique" ON "agent_accounts" ("user_id","id");
CREATE TABLE "agent_account_connections" (
 "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
 "authorization_connection_id" uuid NOT NULL,
 "agent_account_id" uuid NOT NULL,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
 PRIMARY KEY ("user_id","authorization_connection_id"),
 CONSTRAINT "agent_account_connections_owner_fk" FOREIGN KEY ("user_id","agent_account_id") REFERENCES "agent_accounts"("user_id","id") ON DELETE CASCADE
);
CREATE INDEX "agent_account_connections_account_idx" ON "agent_account_connections" ("user_id","agent_account_id");
