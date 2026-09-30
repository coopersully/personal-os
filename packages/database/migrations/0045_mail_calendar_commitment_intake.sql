ALTER TABLE "mail_messages" ADD COLUMN "provider_mailbox_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "mail_messages" ADD COLUMN "provider_revision" text;
--> statement-breakpoint
CREATE TABLE "mail_calendar_commitment_intakes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"source_thread_id" uuid,
	"source_message_id" uuid,
	"remote_thread_id" text NOT NULL,
	"remote_message_id" text NOT NULL,
	"remote_part_id" text NOT NULL,
	"source_thread_revision" timestamp with time zone NOT NULL,
	"source_fingerprint" text NOT NULL,
	"source_message_mailbox_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_message_revision" text,
	"authenticated_account_address_hash" text,
	"attachment_fingerprint" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"attachment" jsonb NOT NULL,
	"evidence_kind" text NOT NULL,
	"authority" text DEFAULT 'provider_projected_unverified' NOT NULL,
	"status" text DEFAULT 'preview_only' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_calendar_commitment_intake_source_fingerprint_check" CHECK (
		"source_fingerprint" ~ '^[0-9a-f]{64}$'
		AND "attachment_fingerprint" ~ '^[0-9a-f]{64}$'
		AND "idempotency_key" ~ '^[0-9a-f]{64}$'
	),
	CONSTRAINT "mail_calendar_commitment_intake_account_address_hash_check" CHECK (
		"authenticated_account_address_hash" IS NULL
		OR "authenticated_account_address_hash" ~ '^[0-9a-f]{64}$'
	),
	CONSTRAINT "mail_calendar_commitment_intake_authority_check" CHECK (
		"authority" IN ('provider_projected_unverified', 'server_verified')
	),
	CONSTRAINT "mail_calendar_commitment_intake_status_check" CHECK (
		"status" IN ('preview_only', 'pending', 'claimed', 'reconcile', 'succeeded', 'failed')
	)
);
--> statement-breakpoint
ALTER TABLE "mail_calendar_commitment_intakes"
	ADD CONSTRAINT "mail_calendar_commitment_intakes_user_id_users_id_fk"
	FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mail_calendar_commitment_intakes"
	ADD CONSTRAINT "mail_calendar_commitment_intakes_account_id_calendar_accounts_id_fk"
	FOREIGN KEY ("account_id") REFERENCES "public"."calendar_accounts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mail_calendar_commitment_intakes"
	ADD CONSTRAINT "mail_calendar_commitment_intakes_source_thread_id_mail_threads_id_fk"
	FOREIGN KEY ("source_thread_id") REFERENCES "public"."mail_threads"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mail_calendar_commitment_intakes"
	ADD CONSTRAINT "mail_calendar_commitment_intakes_source_message_id_mail_messages_id_fk"
	FOREIGN KEY ("source_message_id") REFERENCES "public"."mail_messages"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "mail_calendar_commitment_intake_identity_idx"
	ON "mail_calendar_commitment_intakes" USING btree (
		"account_id",
		"remote_message_id",
		"remote_part_id"
	);
--> statement-breakpoint
CREATE UNIQUE INDEX "mail_calendar_commitment_intake_idempotency_idx"
	ON "mail_calendar_commitment_intakes" USING btree ("idempotency_key");
--> statement-breakpoint
CREATE INDEX "mail_calendar_commitment_intake_user_status_idx"
	ON "mail_calendar_commitment_intakes" USING btree ("user_id", "status");
