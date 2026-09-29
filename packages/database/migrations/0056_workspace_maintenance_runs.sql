CREATE TABLE "workspace_maintenance_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"scope" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"rulebook_version" text NOT NULL,
	"source_snapshot" jsonb,
	"checkpoint" jsonb,
	"lease_claim_id" uuid,
	"lease_expires_at" timestamp with time zone,
	"retry_at" timestamp with time zone,
	"last_safe_error" jsonb,
	"settled_result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_maintenance_runs_status_check" CHECK ("status" IN ('queued', 'running', 'completed', 'completed_with_questions', 'awaiting_approval', 'blocked', 'failed_recoverable', 'failed_terminal')),
	CONSTRAINT "workspace_maintenance_runs_lease_check" CHECK (
		("status" = 'running' AND "lease_claim_id" IS NOT NULL AND "lease_expires_at" IS NOT NULL)
		OR
		("status" <> 'running' AND "lease_claim_id" IS NULL AND "lease_expires_at" IS NULL)
	),
	CONSTRAINT "workspace_maintenance_runs_retry_check" CHECK (
		("status" = 'failed_recoverable' AND "retry_at" IS NOT NULL)
		OR
		("status" <> 'failed_recoverable' AND "retry_at" IS NULL)
	)
);
--> statement-breakpoint
CREATE TABLE "workspace_maintenance_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"step_name" text NOT NULL,
	"status" text NOT NULL,
	"attempt_count" integer DEFAULT 1 NOT NULL,
	"idempotency_key" text NOT NULL,
	"attempt_claim_id" uuid NOT NULL,
	"safe_result" jsonb,
	"safe_error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_maintenance_steps_status_check" CHECK ("status" IN ('completed', 'failed_recoverable', 'failed_terminal')),
	CONSTRAINT "workspace_maintenance_steps_attempt_check" CHECK ("attempt_count" > 0),
	CONSTRAINT "workspace_maintenance_steps_result_check" CHECK (
		("status" = 'completed' AND "safe_error" IS NULL)
		OR
		("status" IN ('failed_recoverable', 'failed_terminal') AND "safe_result" IS NULL AND "safe_error" IS NOT NULL)
	)
);
--> statement-breakpoint
ALTER TABLE "workspace_maintenance_runs" ADD CONSTRAINT "workspace_maintenance_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_maintenance_steps" ADD CONSTRAINT "workspace_maintenance_steps_run_id_workspace_maintenance_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workspace_maintenance_runs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_maintenance_runs_open_user_domain_idx" ON "workspace_maintenance_runs" USING btree ("user_id", "domain") WHERE "status" IN ('queued', 'running', 'awaiting_approval', 'blocked', 'failed_recoverable');
--> statement-breakpoint
CREATE INDEX "workspace_maintenance_runs_claimable_idx" ON "workspace_maintenance_runs" USING btree ("status", "retry_at", "lease_expires_at", "updated_at") WHERE "status" IN ('queued', 'running', 'failed_recoverable');
--> statement-breakpoint
CREATE INDEX "workspace_maintenance_runs_user_history_idx" ON "workspace_maintenance_runs" USING btree ("user_id", "domain", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_maintenance_steps_run_step_idx" ON "workspace_maintenance_steps" USING btree ("run_id", "step_name");
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_maintenance_steps_run_idempotency_idx" ON "workspace_maintenance_steps" USING btree ("run_id", "idempotency_key");
