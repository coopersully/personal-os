CREATE TABLE finance_opening_statements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 account_id uuid NOT NULL, month text NOT NULL, revision integer NOT NULL,
 account_revision text NOT NULL, timezone text NOT NULL,
 signed_opening_balance_cents bigint NOT NULL, currency_code text NOT NULL,
 actor_id uuid NOT NULL, idempotency_key text NOT NULL, fingerprint text NOT NULL,
 recorded_at timestamptz NOT NULL,
 CONSTRAINT finance_opening_statement_account_owner FOREIGN KEY (user_id, account_id) REFERENCES finance_accounts(user_id, id) ON DELETE CASCADE,
 CONSTRAINT finance_opening_statement_owner_actor CHECK (actor_id = user_id),
 CONSTRAINT finance_opening_statement_positive_revision CHECK (revision > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX finance_opening_statement_owner_key ON finance_opening_statements(user_id, idempotency_key);
--> statement-breakpoint
CREATE UNIQUE INDEX finance_opening_statement_revision ON finance_opening_statements(user_id, account_id, month, revision);
