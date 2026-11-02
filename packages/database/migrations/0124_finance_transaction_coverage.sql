CREATE TABLE finance_transaction_coverage (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 account_id uuid NOT NULL,
 from_date date NOT NULL, through_date date NOT NULL,
 timezone text NOT NULL, currency_code text NOT NULL,
 evidence_ref text NOT NULL, recorded_at timestamptz NOT NULL,
 CONSTRAINT finance_transaction_coverage_account_fk FOREIGN KEY(user_id,account_id) REFERENCES finance_accounts(user_id,id) ON DELETE CASCADE,
 CONSTRAINT finance_transaction_coverage_period_check CHECK(from_date <= through_date),
 CONSTRAINT finance_transaction_coverage_currency_check CHECK(currency_code ~ '^[A-Z]{3}$'),
 CONSTRAINT finance_transaction_coverage_evidence_check CHECK(length(trim(evidence_ref)) > 0 AND length(trim(timezone)) > 0)
);
--> statement-breakpoint
CREATE INDEX finance_transaction_coverage_owner_account_idx ON finance_transaction_coverage(user_id,account_id);
