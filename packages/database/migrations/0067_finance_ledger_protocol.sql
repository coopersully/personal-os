CREATE TABLE "finance_economic_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "kind" text NOT NULL CHECK ("kind" IN ('duplicate', 'income', 'other', 'purchase', 'refund', 'reimbursement', 'reversal', 'split', 'transfer')),
  "stable_key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "finance_event_transactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "economic_event_id" uuid NOT NULL REFERENCES "finance_economic_events"("id") ON DELETE cascade,
  "transaction_id" uuid NOT NULL REFERENCES "finance_transactions"("id") ON DELETE cascade,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "finance_transaction_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "transaction_id" uuid NOT NULL REFERENCES "finance_transactions"("id") ON DELETE cascade,
  "version" integer NOT NULL CHECK ("version" > 0),
  "changes" jsonb NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "finance_transaction_relationships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "economic_event_id" uuid NOT NULL REFERENCES "finance_economic_events"("id") ON DELETE cascade,
  "relationship" text NOT NULL CHECK ("relationship" IN ('duplicate', 'refund', 'reimbursement', 'reversal', 'split', 'transfer')),
  "transaction_ids" jsonb NOT NULL,
  "rationale" text NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "finance_economic_events_user_stable_key_idx"
  ON "finance_economic_events" ("user_id", "stable_key");
CREATE INDEX "finance_economic_events_user_updated_idx"
  ON "finance_economic_events" ("user_id", "updated_at");
CREATE UNIQUE INDEX "finance_event_transactions_event_transaction_idx"
  ON "finance_event_transactions" ("economic_event_id", "transaction_id");
CREATE UNIQUE INDEX "finance_event_transactions_transaction_idx"
  ON "finance_event_transactions" ("transaction_id");
CREATE UNIQUE INDEX "finance_transaction_revisions_transaction_version_idx"
  ON "finance_transaction_revisions" ("transaction_id", "version");
CREATE INDEX "finance_transaction_revisions_user_created_idx"
  ON "finance_transaction_revisions" ("user_id", "created_at");
CREATE INDEX "finance_transaction_relationships_event_idx"
  ON "finance_transaction_relationships" ("economic_event_id");

ALTER TABLE "finance_review_cases" ADD COLUMN "economic_event_id" uuid;
ALTER TABLE "finance_review_cases" ADD COLUMN "stable_key" text;
ALTER TABLE "finance_review_cases" ADD COLUMN "reason_code" text;
ALTER TABLE "finance_review_cases" ADD COLUMN "evidence" jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "finance_review_cases" ADD COLUMN "proposed_resolution" jsonb;
ALTER TABLE "finance_review_cases" ADD COLUMN "impact_amount_cents" integer DEFAULT 0 NOT NULL;
ALTER TABLE "finance_review_cases" ADD COLUMN "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "finance_review_cases" ADD COLUMN "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "finance_review_cases" ADD COLUMN "reopened_from_id" uuid;
ALTER TABLE "finance_review_cases" ADD COLUMN "resolution" jsonb;
ALTER TABLE "finance_review_cases" ADD COLUMN "resolved_by_actor_type" text;
ALTER TABLE "finance_review_cases" ADD COLUMN "resolved_by_actor_id" text;
ALTER TABLE "finance_review_cases" ADD COLUMN "resolution_provenance" jsonb;

UPDATE "finance_review_cases"
SET
  "stable_key" = "transaction_id"::text || ':' || "reason",
  "reason_code" = CASE "reason"
    WHEN 'ambiguous_merchant' THEN 'merchant_identity'
    WHEN 'low_confidence' THEN 'category_ambiguity'
    WHEN 'one_time' THEN 'recurring_status'
    WHEN 'possible_duplicate' THEN 'possible_duplicate'
    WHEN 'possible_transfer' THEN 'possible_transfer'
    WHEN 'refund_or_reversal' THEN 'refund_or_reversal'
    WHEN 'unknown_merchant' THEN 'merchant_identity'
    ELSE 'missing_provenance'
  END,
  "first_seen_at" = "created_at",
  "last_seen_at" = "updated_at";

-- The legacy index allowed one open and one deferred row for the same question. Keep the newest active.
WITH ranked_active AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "user_id", "stable_key"
      ORDER BY "updated_at" DESC, "created_at" DESC, "id" DESC
    ) AS active_rank
  FROM "finance_review_cases"
  WHERE "status" IN ('open', 'deferred')
)
UPDATE "finance_review_cases" review
SET
  "status" = 'resolved',
  "resolved_at" = COALESCE(review."resolved_at", now()),
  "resolution" = jsonb_build_object('type', 'migration_deduplication')
FROM ranked_active ranked
WHERE review."id" = ranked."id" AND ranked.active_rank > 1;

ALTER TABLE "finance_review_cases" ALTER COLUMN "stable_key" SET NOT NULL;
ALTER TABLE "finance_review_cases" ALTER COLUMN "stable_key"
  SET DEFAULT ('legacy:' || gen_random_uuid()::text);
ALTER TABLE "finance_review_cases" ALTER COLUMN "reason_code" SET NOT NULL;
ALTER TABLE "finance_review_cases" ALTER COLUMN "reason_code" SET DEFAULT 'missing_provenance';
ALTER TABLE "finance_review_cases" ALTER COLUMN "reason" SET DEFAULT 'low_confidence';
ALTER TABLE "finance_review_cases"
  ADD CONSTRAINT "finance_review_cases_economic_event_id_fk"
  FOREIGN KEY ("economic_event_id") REFERENCES "finance_economic_events"("id") ON DELETE set null;
ALTER TABLE "finance_review_cases"
  ADD CONSTRAINT "finance_review_cases_reopened_from_id_fk"
  FOREIGN KEY ("reopened_from_id") REFERENCES "finance_review_cases"("id") ON DELETE set null;
ALTER TABLE "finance_review_cases"
  ADD CONSTRAINT "finance_review_cases_impact_amount_check" CHECK ("impact_amount_cents" >= 0);

DROP INDEX "finance_review_cases_open_transaction_idx";
CREATE UNIQUE INDEX "finance_review_cases_active_stable_key_unique"
  ON "finance_review_cases" ("user_id", "stable_key")
  WHERE "status" IN ('open', 'deferred');
CREATE INDEX "finance_review_cases_event_idx" ON "finance_review_cases" ("economic_event_id");
CREATE INDEX "finance_review_cases_reopened_idx" ON "finance_review_cases" ("reopened_from_id");

CREATE TABLE "finance_maintenance_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "stage" text DEFAULT 'deterministic_processing' NOT NULL CHECK (
    "stage" IN ('agent_audit', 'agent_reasoning', 'deterministic_processing', 'failed', 'reconciliation', 'settled')
  ),
  "scope" jsonb NOT NULL,
  "version" integer DEFAULT 1 NOT NULL CHECK ("version" > 0),
  "error" jsonb,
  "settled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "finance_maintenance_judgments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "run_id" uuid NOT NULL REFERENCES "finance_maintenance_runs"("id") ON DELETE cascade,
  "judgment_key" text NOT NULL,
  "type" text NOT NULL CHECK ("type" IN ('classify_transaction', 'link_transactions', 'needs_user_review')),
  "payload" jsonb NOT NULL,
  "provenance" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "finance_audit_findings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "run_id" uuid NOT NULL REFERENCES "finance_maintenance_runs"("id") ON DELETE cascade,
  "economic_event_id" uuid NOT NULL REFERENCES "finance_economic_events"("id") ON DELETE cascade,
  "stable_key" text NOT NULL,
  "reason_code" text NOT NULL,
  "evidence" jsonb NOT NULL,
  "impact_amount_cents" integer NOT NULL CHECK ("impact_amount_cents" >= 0),
  "rationale" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "finance_mutation_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "idempotency_key" text NOT NULL,
  "operation" text NOT NULL,
  "request_hash" text NOT NULL,
  "actor_type" text NOT NULL,
  "actor_id" text,
  "status" text NOT NULL CHECK ("status" IN ('completed', 'failed', 'started')),
  "response" jsonb,
  "error" jsonb,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "finance_account_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "provider" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL CHECK ("status" IN ('connected', 'disconnected', 'failed', 'needs_reauth', 'pending')),
  "account_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "external_handoff_url" text,
  "external_handoff_expires_at" timestamp with time zone,
  "last_error" jsonb,
  "version" integer DEFAULT 1 NOT NULL CHECK ("version" > 0),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "finance_maintenance_runs_user_stage_idx"
  ON "finance_maintenance_runs" ("user_id", "stage");
CREATE UNIQUE INDEX "finance_maintenance_judgments_run_key_idx"
  ON "finance_maintenance_judgments" ("run_id", "judgment_key");
CREATE UNIQUE INDEX "finance_audit_findings_run_stable_key_idx"
  ON "finance_audit_findings" ("run_id", "stable_key");
CREATE UNIQUE INDEX "finance_mutation_records_user_key_idx"
  ON "finance_mutation_records" ("user_id", "idempotency_key");
CREATE INDEX "finance_mutation_records_user_operation_idx"
  ON "finance_mutation_records" ("user_id", "operation");
CREATE INDEX "finance_account_connections_user_status_idx"
  ON "finance_account_connections" ("user_id", "status");

ALTER TABLE "finance_setup_sessions"
  ADD CONSTRAINT "finance_setup_sessions_maintenance_run_id_fk"
  FOREIGN KEY ("maintenance_run_id") REFERENCES "finance_maintenance_runs"("id") ON DELETE set null;
