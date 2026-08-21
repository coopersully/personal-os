CREATE TABLE "finance_maintenance_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"state" text DEFAULT 'preparing' NOT NULL,
	"revision" text NOT NULL,
	"projection" jsonb DEFAULT '{"budgetActual":null,"budgetTotal":null,"budgetVariance":null,"grossCashSpending":0,"matchedReimbursementIncome":0,"monthlyCapacity":null,"personalSpending":0,"plannedIncome":0,"profileExpectedNetIncome":null,"questions":0,"recurringCommittedOutflow":0,"reimbursementsOutstanding":0,"workItems":0}'::jsonb NOT NULL,
	"preparation_cursor" text,
	"next_ordinal" integer DEFAULT 0 NOT NULL,
	"discovery_revision" text,
	"preparation_checkpoint" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "finance_maintenance_candidates_state_check" CHECK ("state" IN ('preparing', 'ready_for_challenge', 'challenged', 'awaiting_approval', 'committing', 'committed', 'superseded')),
	CONSTRAINT "finance_maintenance_candidates_next_ordinal_check" CHECK ("next_ordinal" >= 0)
);
--> statement-breakpoint
ALTER TABLE "finance_maintenance_candidates" ADD CONSTRAINT "finance_maintenance_candidates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_maintenance_runs_id_user_id_unique" ON "workspace_maintenance_runs" USING btree ("id", "user_id");
--> statement-breakpoint
ALTER TABLE "finance_maintenance_candidates" ADD CONSTRAINT "finance_maintenance_candidates_run_user_fk" FOREIGN KEY ("run_id", "user_id") REFERENCES "public"."workspace_maintenance_runs"("id", "user_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_maintenance_candidates_active_run_idx" ON "finance_maintenance_candidates" USING btree ("run_id") WHERE "state" <> 'superseded';
--> statement-breakpoint
CREATE INDEX "finance_maintenance_candidates_user_state_idx" ON "finance_maintenance_candidates" USING btree ("user_id", "state", "updated_at");
--> statement-breakpoint
CREATE TABLE "finance_maintenance_candidate_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"action_kind" text NOT NULL,
	"private_payload" jsonb NOT NULL,
	"safe_changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expected_revision" text,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"disposition" text DEFAULT 'prepared' NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "finance_maintenance_candidate_items_ordinal_check" CHECK ("ordinal" >= 0),
	CONSTRAINT "finance_maintenance_candidate_items_disposition_check" CHECK ("disposition" IN ('prepared', 'question', 'removed', 'committed'))
);
--> statement-breakpoint
ALTER TABLE "finance_maintenance_candidate_items" ADD CONSTRAINT "finance_maintenance_candidate_items_candidate_id_finance_maintenance_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."finance_maintenance_candidates"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_maintenance_candidate_items_candidate_ordinal_idx" ON "finance_maintenance_candidate_items" USING btree ("candidate_id", "ordinal");
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_maintenance_candidate_items_candidate_fingerprint_idx" ON "finance_maintenance_candidate_items" USING btree ("candidate_id", "fingerprint");
--> statement-breakpoint
CREATE INDEX "finance_maintenance_candidate_items_candidate_disposition_idx" ON "finance_maintenance_candidate_items" USING btree ("candidate_id", "disposition", "ordinal");
