ALTER TABLE "finance_planning_evidence" ADD COLUMN "approval_actor" jsonb;
--> statement-breakpoint
ALTER TABLE "finance_planning_evidence" ADD CONSTRAINT "finance_planning_evidence_approval_actor_check" CHECK (approval_actor IS NULL OR (jsonb_typeof(approval_actor) = 'object' AND approval_actor->>'type' = 'agent' AND length(approval_actor->>'id') > 0) IS TRUE);
--> statement-breakpoint
ALTER TABLE "finance_recurring_schedule_versions" ADD COLUMN "approval_actor" jsonb;
--> statement-breakpoint
ALTER TABLE "finance_recurring_schedule_versions" ADD CONSTRAINT "finance_recurring_schedule_versions_approval_actor_check" CHECK (approval_actor IS NULL OR (jsonb_typeof(approval_actor) = 'object' AND approval_actor->>'type' = 'agent' AND length(approval_actor->>'id') > 0) IS TRUE);
--> statement-breakpoint
ALTER TABLE "finance_occurrence_match_events" ADD COLUMN "approval_actor" jsonb;
--> statement-breakpoint
ALTER TABLE "finance_occurrence_match_events" ADD CONSTRAINT "finance_occurrence_match_events_approval_actor_check" CHECK (approval_actor IS NULL OR (jsonb_typeof(approval_actor) = 'object' AND approval_actor->>'type' = 'agent' AND length(approval_actor->>'id') > 0) IS TRUE);
--> statement-breakpoint
ALTER TABLE "finance_cash_balance_bases" ADD COLUMN "approval_actor" jsonb;
--> statement-breakpoint
ALTER TABLE "finance_cash_balance_bases" ADD CONSTRAINT "finance_cash_balance_bases_approval_actor_check" CHECK (approval_actor IS NULL OR (jsonb_typeof(approval_actor) = 'object' AND approval_actor->>'type' = 'agent' AND length(approval_actor->>'id') > 0) IS TRUE);
--> statement-breakpoint
ALTER TABLE "finance_budget_baseline_qualifications" ADD COLUMN "confirmed_by_actor_type" text DEFAULT 'user' NOT NULL;
--> statement-breakpoint
ALTER TABLE "finance_budget_baseline_qualifications" DROP CONSTRAINT "finance_budget_baseline_qualifications_human_check";
--> statement-breakpoint
ALTER TABLE "finance_budget_baseline_qualifications" ADD CONSTRAINT "finance_budget_baseline_qualifications_actor_check" CHECK ((confirmed_by_actor_type = 'user' AND confirmed_by_actor_id = user_id::text) OR (confirmed_by_actor_type = 'agent' AND length(confirmed_by_actor_id) > 0));
