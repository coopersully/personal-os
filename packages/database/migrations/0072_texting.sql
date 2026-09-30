CREATE TABLE "texting_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "encrypted_phone_number" jsonb NOT NULL,
  "phone_fingerprint" text NOT NULL,
  "phone_last_four" text NOT NULL,
  "country" text NOT NULL,
  "state" text DEFAULT 'active' NOT NULL,
  "consent_version" text NOT NULL,
  "consent_epoch" integer DEFAULT 1 NOT NULL,
  "conversation_revision" integer DEFAULT 0 NOT NULL,
  "verified_at" timestamp with time zone NOT NULL,
  "opted_out_at" timestamp with time zone,
  "disconnected_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "texting_connections_user_idx" ON "texting_connections" USING btree ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "texting_connections_active_phone_idx" ON "texting_connections" USING btree ("phone_fingerprint") WHERE "texting_connections"."state" <> 'disconnected';
--> statement-breakpoint
CREATE TABLE "texting_verification_challenges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "encrypted_phone_number" jsonb NOT NULL,
  "phone_fingerprint" text NOT NULL,
  "phone_last_four" text NOT NULL,
  "country" text NOT NULL,
  "provider_verification_sid" text NOT NULL,
  "consent_version" text NOT NULL,
  "status" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "approved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "texting_verification_user_idx" ON "texting_verification_challenges" USING btree ("user_id", "created_at");
--> statement-breakpoint
CREATE TABLE "text_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "connection_id" uuid NOT NULL REFERENCES "texting_connections"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "provider_message_sid" text,
  "direction" text NOT NULL,
  "status" text NOT NULL,
  "body" text NOT NULL,
  "content_kind" text,
  "predicted_segments" integer,
  "actual_segments" integer,
  "series_id" uuid,
  "series_part" integer,
  "series_total" integer,
  "occurred_at" timestamp with time zone NOT NULL,
  "occurred_at_source" text NOT NULL,
  "sent_at" timestamp with time zone,
  "delivered_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "text_messages_provider_sid_idx" ON "text_messages" USING btree ("provider_message_sid");
--> statement-breakpoint
CREATE INDEX "text_messages_conversation_idx" ON "text_messages" USING btree ("connection_id", "occurred_at", "id");
--> statement-breakpoint
CREATE INDEX "text_messages_user_outbound_idx" ON "text_messages" USING btree ("user_id", "direction", "created_at");
--> statement-breakpoint
CREATE TABLE "texting_consent_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "connection_id" uuid REFERENCES "texting_connections"("id") ON DELETE set null,
  "user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "phone_fingerprint" text NOT NULL,
  "kind" text NOT NULL,
  "source" text NOT NULL,
  "provider_event_id" text,
  "occurred_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "texting_consent_phone_idx" ON "texting_consent_events" USING btree ("phone_fingerprint", "occurred_at");
--> statement-breakpoint
