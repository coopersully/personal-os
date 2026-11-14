CREATE TABLE finance_evidence_refresh_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 actor_id text NOT NULL, actor_type text NOT NULL,
 idempotency_key text NOT NULL, fingerprint text NOT NULL,
 period text NOT NULL, timezone text NOT NULL, sources jsonb NOT NULL,
 requested_at timestamptz NOT NULL, next_observation_at timestamptz NOT NULL, result jsonb DEFAULT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX finance_evidence_refresh_owner_key ON finance_evidence_refresh_requests(user_id, idempotency_key);
--> statement-breakpoint
CREATE INDEX finance_evidence_refresh_pending ON finance_evidence_refresh_requests(next_observation_at) WHERE result IS NULL;
