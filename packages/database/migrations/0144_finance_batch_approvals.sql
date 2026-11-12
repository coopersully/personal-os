CREATE UNIQUE INDEX finance_review_batch_runs_owner_id_idx ON finance_review_batch_runs(user_id,id);
--> statement-breakpoint
CREATE TABLE finance_review_batch_approvals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 batch_id uuid NOT NULL, fingerprint text NOT NULL,
 approved_by uuid NOT NULL, approved_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','completed','completed_with_exceptions','cancelled','expired','blocked')),
 claim_id uuid, lease_until timestamptz, next_attempt_at timestamptz NOT NULL,
 failure_code text, attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0), failures integer NOT NULL DEFAULT 0 CHECK(failures >= 0),
 updated_at timestamptz NOT NULL,
 CONSTRAINT finance_batch_approval_owner CHECK(approved_by = user_id),
 CONSTRAINT finance_batch_approval_expiry CHECK(expires_at > approved_at),
 CONSTRAINT finance_batch_approval_batch_fk FOREIGN KEY(user_id,batch_id) REFERENCES finance_review_batch_runs(user_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX finance_batch_approval_once_idx ON finance_review_batch_approvals(user_id,batch_id);
--> statement-breakpoint
CREATE INDEX finance_batch_approval_due_idx ON finance_review_batch_approvals(state,next_attempt_at);
