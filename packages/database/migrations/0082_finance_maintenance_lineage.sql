-- Additive lineage only: historical judgments, findings, stages and effects are retained.
-- Adoption happens under the Finance user lock against current evidence after this deploy.
ALTER TABLE "finance_maintenance_runs" ADD COLUMN "canonical_run_id" uuid;
--> statement-breakpoint
ALTER TABLE "finance_maintenance_runs" ADD COLUMN "recovery" jsonb;
--> statement-breakpoint
ALTER TABLE "finance_setup_sessions" ADD COLUMN "canonical_maintenance_run_id" uuid;
--> statement-breakpoint
ALTER TABLE "finance_maintenance_runs" ADD CONSTRAINT "finance_maintenance_runs_canonical_user_fk"
  FOREIGN KEY ("canonical_run_id", "user_id") REFERENCES "workspace_maintenance_runs" ("id", "user_id");
--> statement-breakpoint
ALTER TABLE "finance_setup_sessions" ADD CONSTRAINT "finance_setup_sessions_canonical_user_fk"
  FOREIGN KEY ("canonical_maintenance_run_id", "user_id") REFERENCES "workspace_maintenance_runs" ("id", "user_id");
--> statement-breakpoint
ALTER TABLE "finance_maintenance_runs" ADD CONSTRAINT "finance_maintenance_runs_recovery_check" CHECK ((
  ("recovery" IS NULL AND "canonical_run_id" IS NULL AND "stage" <> 'superseded')
  OR ("recovery" IS NOT NULL AND "stage" = 'superseded'
    AND "recovery"->>'legacyRunId' = "id"::text
    AND "recovery"->'originalScope' = "scope"
    AND "recovery"->>'originalStage' IN ('deterministic_processing', 'agent_reasoning', 'reconciliation', 'agent_audit')
    AND (("recovery"->>'state' = 'adopted' AND "canonical_run_id" IS NOT NULL)
      OR ("recovery"->>'state' = 'blocked' AND "canonical_run_id" IS NULL)))
) IS TRUE);

--> statement-breakpoint
ALTER TABLE "finance_maintenance_runs" DROP CONSTRAINT "finance_maintenance_runs_stage_check";
--> statement-breakpoint
ALTER TABLE "finance_maintenance_runs" ADD CONSTRAINT "finance_maintenance_runs_stage_check"
  CHECK ("stage" IN ('agent_audit', 'agent_reasoning', 'deterministic_processing', 'failed', 'reconciliation', 'settled', 'superseded'));
