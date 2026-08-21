CREATE TABLE "finance_ledger_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"candidate_revision" text NOT NULL,
	"rubric_version" text NOT NULL,
	"cutoff" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'prepared' NOT NULL,
	"coverage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"submitting_agent_id" text,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_ledger_challenges_state_check" CHECK ("state" IN ('prepared', 'submitted', 'resolved'))
);
--> statement-breakpoint
CREATE TABLE "finance_ledger_challenge_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challenge_id" uuid NOT NULL,
	"candidate_item_id" uuid,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence" text NOT NULL,
	"rationale" text NOT NULL,
	"resolution" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_ledger_challenge_findings_kind_check" CHECK ("kind" IN ('correction', 'question', 'blocker', 'observation')),
	CONSTRAINT "finance_ledger_challenge_findings_severity_check" CHECK ("severity" IN ('info', 'warning', 'blocker'))
);
--> statement-breakpoint
ALTER TABLE "finance_ledger_challenges" ADD CONSTRAINT "finance_ledger_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "finance_ledger_challenges" ADD CONSTRAINT "finance_ledger_challenges_run_id_workspace_maintenance_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workspace_maintenance_runs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "finance_ledger_challenges" ADD CONSTRAINT "finance_ledger_challenges_candidate_id_finance_maintenance_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."finance_maintenance_candidates"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "finance_ledger_challenge_findings" ADD CONSTRAINT "finance_ledger_challenge_findings_challenge_id_finance_ledger_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."finance_ledger_challenges"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "finance_ledger_challenge_findings" ADD CONSTRAINT "finance_ledger_challenge_findings_candidate_item_id_finance_maintenance_candidate_items_id_fk" FOREIGN KEY ("candidate_item_id") REFERENCES "public"."finance_maintenance_candidate_items"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_ledger_challenges_run_idx" ON "finance_ledger_challenges" USING btree ("run_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_ledger_challenges_candidate_idx" ON "finance_ledger_challenges" USING btree ("candidate_id");
--> statement-breakpoint
CREATE INDEX "finance_ledger_challenges_user_state_idx" ON "finance_ledger_challenges" USING btree ("user_id", "state", "updated_at");
--> statement-breakpoint
CREATE INDEX "finance_ledger_challenge_findings_challenge_idx" ON "finance_ledger_challenge_findings" USING btree ("challenge_id", "created_at");
