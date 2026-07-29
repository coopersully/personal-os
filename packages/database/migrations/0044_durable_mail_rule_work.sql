CREATE TABLE "mail_rule_work_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"profile_id" uuid,
	"thread_id" uuid,
	"remote_thread_id" text NOT NULL,
	"rule_version" integer NOT NULL,
	"profile_version" integer NOT NULL,
	"source_updated_at" timestamp with time zone NOT NULL,
	"action" jsonb NOT NULL,
	"action_fingerprint" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"claim_id" uuid,
	"claimed_at" timestamp with time zone,
	"claim_mode" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"provider_effect" text DEFAULT 'none' NOT NULL,
	"last_error_code" text,
	"last_error_message" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_rule_work_revision_check" CHECK (
		"rule_version" > 0 AND "profile_version" > 0
	),
	CONSTRAINT "mail_rule_work_action_fingerprint_check" CHECK (
		"action_fingerprint" ~ '^[0-9a-f]{64}$'
	),
	CONSTRAINT "mail_rule_work_attempt_count_check" CHECK (
		"attempt_count" >= 0 AND "attempt_count" <= 5
	),
	CONSTRAINT "mail_rule_work_provider_effect_check" CHECK (
		"provider_effect" IN ('none', 'rejected', 'indeterminate', 'applied')
	),
	CONSTRAINT "mail_rule_work_claim_mode_check" CHECK (
		"claim_mode" IS NULL OR "claim_mode" IN ('execute', 'reconcile')
	),
	CONSTRAINT "mail_rule_work_claim_state_check" CHECK (
		(
			"status" = 'claimed'
			AND "claim_id" IS NOT NULL
			AND "claimed_at" IS NOT NULL
			AND "claim_mode" IS NOT NULL
			AND "completed_at" IS NULL
		)
		OR (
			"status" IN ('pending', 'reconcile')
			AND "claim_id" IS NULL
			AND "claimed_at" IS NULL
			AND "claim_mode" IS NULL
			AND "completed_at" IS NULL
		)
		OR (
			"status" IN ('succeeded', 'failed')
			AND "claim_id" IS NULL
			AND "claimed_at" IS NULL
			AND "claim_mode" IS NULL
			AND "completed_at" IS NOT NULL
		)
	)
);
--> statement-breakpoint
ALTER TABLE "mail_rule_work_items"
	ADD CONSTRAINT "mail_rule_work_items_user_id_users_id_fk"
	FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mail_rule_work_items"
	ADD CONSTRAINT "mail_rule_work_items_account_id_calendar_accounts_id_fk"
	FOREIGN KEY ("account_id") REFERENCES "public"."calendar_accounts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mail_rule_work_items"
	ADD CONSTRAINT "mail_rule_work_items_rule_id_mail_rules_id_fk"
	FOREIGN KEY ("rule_id") REFERENCES "public"."mail_rules"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mail_rule_work_items"
	ADD CONSTRAINT "mail_rule_work_items_profile_id_domain_profiles_id_fk"
	FOREIGN KEY ("profile_id") REFERENCES "public"."domain_profiles"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mail_rule_work_items"
	ADD CONSTRAINT "mail_rule_work_items_thread_id_mail_threads_id_fk"
	FOREIGN KEY ("thread_id") REFERENCES "public"."mail_threads"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "mail_rule_work_identity_idx"
	ON "mail_rule_work_items" USING btree (
		"account_id",
		"remote_thread_id",
		"rule_id",
		"rule_version",
		"profile_version",
		"action_fingerprint"
	);
--> statement-breakpoint
CREATE INDEX "mail_rule_work_due_idx"
	ON "mail_rule_work_items" USING btree ("status", "next_attempt_at", "due_at");
--> statement-breakpoint
CREATE INDEX "mail_rule_work_account_idx"
	ON "mail_rule_work_items" USING btree ("account_id", "status");
--> statement-breakpoint
CREATE INDEX "mail_rule_work_thread_status_idx"
	ON "mail_rule_work_items" USING btree ("thread_id", "status");
--> statement-breakpoint
CREATE INDEX "mail_rule_work_user_status_idx"
	ON "mail_rule_work_items" USING btree ("user_id", "account_id", "status");
