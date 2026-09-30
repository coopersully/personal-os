ALTER TABLE "calendar_accounts" ADD COLUMN "mail_sync_token" text;
--> statement-breakpoint
CREATE TABLE "connector_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"kind" text NOT NULL,
	"calendar_id" uuid,
	"channel_id" text,
	"remote_resource_id" text,
	"remote_identity_hash" text,
	"verification_token_hash" text,
	"provider_cursor" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone,
	"renew_after" timestamp with time zone,
	"last_notification_at" timestamp with time zone,
	"last_verified_at" timestamp with time zone,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"safe_failure_code" text,
	"next_attempt_at" timestamp with time zone,
	"lease_claim_id" uuid,
	"lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connector_subscriptions_provider_check" CHECK ("provider" IN ('google', 'icloud')),
	CONSTRAINT "connector_subscriptions_kind_check" CHECK ("kind" IN ('gmail_mailbox', 'google_calendar_list', 'google_calendar_events', 'icloud_mail_idle')),
	CONSTRAINT "connector_subscriptions_status_check" CHECK ("status" IN ('pending', 'active', 'renewing', 'expired', 'failed', 'stopped')),
	CONSTRAINT "connector_subscriptions_failure_count_check" CHECK ("failure_count" >= 0),
	CONSTRAINT "connector_subscriptions_lease_check" CHECK (("lease_claim_id" IS NULL) = ("lease_expires_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "connector_sync_triggers" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"first_triggered_at" timestamp with time zone NOT NULL,
	"last_triggered_at" timestamp with time zone NOT NULL,
	"notification_count" integer DEFAULT 1 NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"claim_id" uuid,
	"claim_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connector_sync_triggers_reason_check" CHECK ("reason" IN ('initial', 'notification', 'reconciliation', 'manual', 'retry', 'recovery')),
	CONSTRAINT "connector_sync_triggers_count_check" CHECK ("notification_count" BETWEEN 1 AND 1000000),
	CONSTRAINT "connector_sync_triggers_time_check" CHECK ("first_triggered_at" <= "last_triggered_at"),
	CONSTRAINT "connector_sync_triggers_claim_check" CHECK (("claim_id" IS NULL) = ("claim_expires_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "connector_subscriptions" ADD CONSTRAINT "connector_subscriptions_account_id_calendar_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."calendar_accounts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "connector_subscriptions" ADD CONSTRAINT "connector_subscriptions_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "connector_sync_triggers" ADD CONSTRAINT "connector_sync_triggers_account_id_calendar_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."calendar_accounts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "connector_subscriptions_identity_idx" ON "connector_subscriptions" ("account_id", "kind", "calendar_id") NULLS NOT DISTINCT;
CREATE UNIQUE INDEX "connector_subscriptions_channel_idx" ON "connector_subscriptions" ("channel_id");
CREATE INDEX "connector_subscriptions_due_idx" ON "connector_subscriptions" ("status", "next_attempt_at");
CREATE INDEX "connector_sync_triggers_due_idx" ON "connector_sync_triggers" ("available_at");
