CREATE TABLE finance_decision_declines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 target_kind text NOT NULL CHECK(target_kind IN ('review_batch','budget_start_preview','review_batch_undo')),
 target_id uuid NOT NULL,
 declined_by uuid NOT NULL, declined_at timestamptz NOT NULL,
 CONSTRAINT finance_decision_decline_owner CHECK(declined_by = user_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX finance_decision_decline_once_idx ON finance_decision_declines(user_id,target_kind,target_id);
--> statement-breakpoint
ALTER TABLE finance_review_batch_effects ADD COLUMN applied_by_actor_type text CHECK(applied_by_actor_type IN ('user','agent'));
--> statement-breakpoint
ALTER TABLE finance_review_batch_effects ADD COLUMN applied_by_actor_id text;
