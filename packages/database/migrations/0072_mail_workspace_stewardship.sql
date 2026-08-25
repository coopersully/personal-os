CREATE TABLE "mail_obligations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"source_message_id" uuid,
	"source_revision" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"owner" jsonb NOT NULL,
	"goal_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rationale" text NOT NULL,
	"due_at" timestamp with time zone,
	"next_review_at" timestamp with time zone,
	"closure_evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" text DEFAULT 'explicit' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_obligations_kind_check" CHECK ("kind" IN ('reply', 'follow_up', 'decide', 'schedule', 'record', 'security_review')),
	CONSTRAINT "mail_obligations_state_check" CHECK ("state" IN ('open', 'waiting', 'deferred', 'resolved', 'dismissed')),
	CONSTRAINT "mail_obligations_confidence_check" CHECK ("confidence" IN ('explicit', 'confirmed', 'inferred_candidate')),
	CONSTRAINT "mail_obligations_version_check" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE TABLE "mail_thread_dispositions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"disposition" text NOT NULL,
	"rationale" text NOT NULL,
	"source_thread_revision" timestamp with time zone NOT NULL,
	"version" integer NOT NULL,
	"current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_thread_dispositions_kind_check" CHECK ("disposition" IN ('active', 'deferred', 'waiting', 'delegated', 'reference', 'noise', 'resolved')),
	CONSTRAINT "mail_thread_dispositions_version_check" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE TABLE "mail_stewardship_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"answer" text,
	"answered_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_stewardship_questions_fingerprint_check" CHECK ("fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "mail_stewardship_questions_status_check" CHECK ("status" IN ('open', 'answered', 'dismissed')),
	CONSTRAINT "mail_stewardship_questions_answer_check" CHECK (("status" = 'answered') = ("answer" IS NOT NULL AND "answered_at" IS NOT NULL)),
	CONSTRAINT "mail_stewardship_questions_version_check" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE TABLE "mail_rule_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"rationale" text NOT NULL,
	"examples" jsonb NOT NULL,
	"counterexamples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"exceptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"approved_rule_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_rule_proposals_fingerprint_check" CHECK ("fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "mail_rule_proposals_status_check" CHECK ("status" IN ('proposed', 'dismissed', 'approved')),
	CONSTRAINT "mail_rule_proposals_version_check" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE TABLE "mail_stewardship_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"comment" text NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_stewardship_feedback_kind_check" CHECK ("kind" IN ('correct', 'incorrect', 'outdated', 'exception'))
);
--> statement-breakpoint
CREATE TABLE "mail_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"state" text NOT NULL,
	"evidence_cutoff" timestamp with time zone NOT NULL,
	"next_maintenance_at" timestamp with time zone NOT NULL,
	"playbook_version" text NOT NULL,
	"rulebook_version" text NOT NULL,
	"profile_version" integer,
	"ledger_fingerprint" text NOT NULL,
	"source_freshness" text NOT NULL,
	"health" jsonb NOT NULL,
	"obligation_counts" jsonb NOT NULL,
	"open_question_count" integer NOT NULL,
	"effect_counts" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_reviews_fingerprint_check" CHECK ("ledger_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "mail_reviews_state_check" CHECK ("state" IN ('maintained', 'maintained_with_questions', 'blocked')),
	CONSTRAINT "mail_reviews_source_freshness_check" CHECK ("source_freshness" IN ('current', 'stale', 'partial', 'unavailable')),
	CONSTRAINT "mail_reviews_count_check" CHECK ("open_question_count" >= 0 AND ("profile_version" IS NULL OR "profile_version" > 0))
);
--> statement-breakpoint
ALTER TABLE "mail_obligations" ADD CONSTRAINT "mail_obligations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mail_obligations" ADD CONSTRAINT "mail_obligations_thread_id_mail_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."mail_threads"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mail_obligations" ADD CONSTRAINT "mail_obligations_source_message_id_mail_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."mail_messages"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mail_thread_dispositions" ADD CONSTRAINT "mail_thread_dispositions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mail_thread_dispositions" ADD CONSTRAINT "mail_thread_dispositions_thread_id_mail_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."mail_threads"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mail_stewardship_questions" ADD CONSTRAINT "mail_stewardship_questions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mail_stewardship_questions" ADD CONSTRAINT "mail_stewardship_questions_account_id_calendar_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."calendar_accounts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mail_stewardship_questions" ADD CONSTRAINT "mail_stewardship_questions_thread_id_mail_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."mail_threads"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mail_rule_proposals" ADD CONSTRAINT "mail_rule_proposals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mail_rule_proposals" ADD CONSTRAINT "mail_rule_proposals_approved_rule_id_mail_rules_id_fk" FOREIGN KEY ("approved_rule_id") REFERENCES "public"."mail_rules"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mail_stewardship_feedback" ADD CONSTRAINT "mail_stewardship_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mail_reviews" ADD CONSTRAINT "mail_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "mail_obligations_user_state_idx" ON "mail_obligations" USING btree ("user_id", "state", "next_review_at", "due_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "mail_obligations_open_identity_idx" ON "mail_obligations" USING btree ("user_id", "thread_id", "kind", "source_revision") WHERE "state" IN ('open', 'waiting', 'deferred');
--> statement-breakpoint
CREATE UNIQUE INDEX "mail_thread_dispositions_current_thread_idx" ON "mail_thread_dispositions" USING btree ("thread_id") WHERE "current" = true;
--> statement-breakpoint
CREATE UNIQUE INDEX "mail_thread_dispositions_thread_version_idx" ON "mail_thread_dispositions" USING btree ("thread_id", "version");
--> statement-breakpoint
CREATE INDEX "mail_thread_dispositions_user_current_idx" ON "mail_thread_dispositions" USING btree ("user_id", "current");
--> statement-breakpoint
CREATE UNIQUE INDEX "mail_stewardship_questions_open_fingerprint_idx" ON "mail_stewardship_questions" USING btree ("user_id", "fingerprint") WHERE "status" = 'open';
--> statement-breakpoint
CREATE INDEX "mail_stewardship_questions_user_status_idx" ON "mail_stewardship_questions" USING btree ("user_id", "status");
--> statement-breakpoint
CREATE UNIQUE INDEX "mail_rule_proposals_user_fingerprint_idx" ON "mail_rule_proposals" USING btree ("user_id", "fingerprint");
--> statement-breakpoint
CREATE INDEX "mail_rule_proposals_user_status_idx" ON "mail_rule_proposals" USING btree ("user_id", "status");
--> statement-breakpoint
CREATE INDEX "mail_stewardship_feedback_user_created_idx" ON "mail_stewardship_feedback" USING btree ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX "mail_stewardship_feedback_target_idx" ON "mail_stewardship_feedback" USING btree ("target_type", "target_id");
--> statement-breakpoint
CREATE INDEX "mail_reviews_user_created_idx" ON "mail_reviews" USING btree ("user_id", "created_at");
