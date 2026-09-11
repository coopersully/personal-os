UPDATE "mail_stewardship_questions"
SET "answer" = NULL, "answered_at" = NULL
WHERE "status" <> 'answered';

UPDATE "mail_stewardship_questions"
SET "status" = 'open', "answer" = NULL, "answered_at" = NULL
WHERE "status" = 'answered'
  AND ("answer" IS NULL OR btrim("answer") = '' OR "answered_at" IS NULL);

ALTER TABLE "mail_stewardship_questions"
  DROP CONSTRAINT "mail_stewardship_questions_answer_check";
ALTER TABLE "mail_stewardship_questions"
  ADD CONSTRAINT "mail_stewardship_questions_answer_check" CHECK (
    ("status" = 'answered' AND "answer" IS NOT NULL AND btrim("answer") <> '' AND "answered_at" IS NOT NULL)
    OR
    ("status" <> 'answered' AND "answer" IS NULL AND "answered_at" IS NULL)
  );

ALTER TABLE "mail_reviews"
  ADD COLUMN "run_id" uuid,
  ADD COLUMN "scope" jsonb DEFAULT '{"type":"all_outstanding"}'::jsonb NOT NULL;
ALTER TABLE "mail_reviews"
  ADD CONSTRAINT "mail_reviews_run_id_workspace_maintenance_runs_id_fk"
  FOREIGN KEY ("run_id") REFERENCES "public"."workspace_maintenance_runs"("id")
  ON DELETE set null ON UPDATE no action;
DROP INDEX "mail_reviews_user_fingerprint_idx";
CREATE UNIQUE INDEX "mail_reviews_user_fingerprint_scope_idx"
  ON "mail_reviews" USING btree ("user_id", "ledger_fingerprint", "scope");
