CREATE TABLE "finance_period_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"cutoff" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"report" jsonb NOT NULL,
	"source_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_period_reviews_period_check" CHECK ("period_start" <= "period_end"),
	CONSTRAINT "finance_period_reviews_status_check" CHECK ("status" IN ('completed', 'completed_with_questions'))
);
--> statement-breakpoint
ALTER TABLE "finance_period_reviews" ADD CONSTRAINT "finance_period_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "finance_period_reviews" ADD CONSTRAINT "finance_period_reviews_run_id_workspace_maintenance_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workspace_maintenance_runs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_period_reviews_run_idx" ON "finance_period_reviews" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX "finance_period_reviews_user_created_idx" ON "finance_period_reviews" USING btree ("user_id", "created_at");
