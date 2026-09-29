ALTER TABLE "finance_profile_versions" ADD COLUMN "planning" jsonb;
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_profile_versions_id_user_idx" ON "finance_profile_versions" ("id", "user_id");
--> statement-breakpoint
ALTER TABLE "finance_budget_versions" ADD COLUMN "profile_version_id" uuid;
--> statement-breakpoint
ALTER TABLE "finance_budget_versions" ADD CONSTRAINT "finance_budget_versions_profile_user_fk"
  FOREIGN KEY ("profile_version_id", "user_id") REFERENCES "finance_profile_versions" ("id", "user_id");
--> statement-breakpoint
ALTER TABLE "finance_setup_sessions" ADD COLUMN "skipped_questions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "question_profile_version_id" uuid,
  ADD COLUMN "proposal_profile_version_id" uuid;
--> statement-breakpoint
ALTER TABLE "finance_setup_sessions" ADD CONSTRAINT "finance_setup_sessions_question_profile_user_fk"
  FOREIGN KEY ("question_profile_version_id", "user_id") REFERENCES "finance_profile_versions" ("id", "user_id");
--> statement-breakpoint
ALTER TABLE "finance_setup_sessions" ADD CONSTRAINT "finance_setup_sessions_proposal_profile_user_fk"
  FOREIGN KEY ("proposal_profile_version_id", "user_id") REFERENCES "finance_profile_versions" ("id", "user_id");
