CREATE INDEX "finance_review_cases_user_first_seen_id_idx" ON "finance_review_cases" USING btree ("user_id", "first_seen_at" DESC, "id" DESC);
