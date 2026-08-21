import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import {
  calendarAccounts,
  connectorSubscriptions,
  connectorSyncTriggers,
  domainProfileApprovals,
  financeAccounts,
  financeAgentActionReviews,
  financeAutomationSettings,
  financeMaintenanceCandidateItems,
  financeMaintenanceCandidates,
  financeMerchants,
  financeProfiles,
  financeProviderItems,
  financeReimbursementMatches,
  financeReimbursements,
  financeTransactionAllocations,
  financeTransactions,
  mailCalendarCommitmentIntakes,
  mailRuleWorkItems,
  oauthStates,
  workspaceMaintenanceRuns,
  workspaceMaintenanceSteps,
} from "./schema.js";

describe("database schema contracts", () => {
  it("keeps one active, owned Finance maintenance candidate with durable private items", async () => {
    const candidates = getTableConfig(financeMaintenanceCandidates);
    const items = getTableConfig(financeMaintenanceCandidateItems);
    expect(candidates.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "user_id",
        "run_id",
        "state",
        "revision",
        "projection",
        "preparation_cursor",
        "next_ordinal",
        "discovery_revision",
        "preparation_checkpoint",
      ]),
    );
    expect(items.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "candidate_id",
        "ordinal",
        "action_kind",
        "private_payload",
        "safe_changes",
        "source_refs",
        "expected_revision",
        "fingerprint",
        "disposition",
      ]),
    );
    expect(candidates.indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining([
        "finance_maintenance_candidates_active_run_idx",
        "finance_maintenance_candidates_user_state_idx",
      ]),
    );
    expect(items.indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining([
        "finance_maintenance_candidate_items_candidate_ordinal_idx",
        "finance_maintenance_candidate_items_candidate_fingerprint_idx",
      ]),
    );
    const migrationSql = await readFile(
      resolve(
        process.cwd(),
        "packages/database/migrations/0063_finance_maintenance_candidates.sql",
      ),
      "utf8",
    );
    expect(migrationSql).toContain('CREATE TABLE "finance_maintenance_candidates"');
    expect(migrationSql).toContain('"grossCashSpending":0');
    expect(migrationSql).toContain('"recurringCommittedOutflow":0');
    expect(migrationSql).toContain('CREATE TABLE "finance_maintenance_candidate_items"');
    expect(migrationSql).toContain("finance_maintenance_candidates_run_user_fk");
    expect(migrationSql).toContain("workspace_maintenance_runs_id_user_id_unique");
    expect(migrationSql).toContain('"preparation_cursor" text');
    expect(migrationSql).toContain('"next_ordinal" integer DEFAULT 0 NOT NULL');
    expect(migrationSql).toContain('"discovery_revision" text');
    expect(migrationSql).toContain('"preparation_checkpoint" jsonb');
    expect(migrationSql).toContain("ON DELETE cascade");
    expect(migrationSql).toContain(
      'ALTER TABLE "workspace_maintenance_runs" DROP CONSTRAINT "workspace_maintenance_runs_status_check"',
    );
    expect(migrationSql).toContain(
      "'awaiting_agent_challenge', 'awaiting_approval', 'blocked', 'failed_recoverable'",
    );
    expect(migrationSql).toContain('DROP INDEX "workspace_maintenance_runs_open_user_domain_idx"');
  });

  it("keeps transaction allocations owned, ordered, and aligned with migration 0061", async () => {
    const merchants = getTableConfig(financeMerchants);
    const allocations = getTableConfig(financeTransactionAllocations);
    expect(merchants.columns.map((column) => column.name)).toContain("behavior");
    expect(allocations.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "user_id",
        "transaction_id",
        "category_id",
        "amount_cents",
        "allocation_order",
        "treatment",
        "rationale",
        "revision",
        "state",
        "invalidated_at",
      ]),
    );
    expect(allocations.indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining([
        "finance_transaction_allocations_user_category_idx",
        "finance_transaction_allocations_transaction_order_idx",
      ]),
    );

    const migrationSql = await readFile(
      resolve(
        process.cwd(),
        "packages/database/migrations/0061_finance_transaction_allocations.sql",
      ),
      "utf8",
    );
    expect(migrationSql).toContain('CREATE TABLE "finance_transaction_allocations"');
    expect(migrationSql).toContain("\"state\" text DEFAULT 'active' NOT NULL");
    expect(migrationSql).toContain('"invalidated_at" timestamptz');
    expect(migrationSql).toContain(
      'CREATE UNIQUE INDEX "finance_transaction_allocations_transaction_order_idx" ON "finance_transaction_allocations" USING btree ("transaction_id", "allocation_order") WHERE "state" = \'active\';',
    );
    expect(migrationSql).not.toContain('INSERT INTO "finance_transaction_allocations"');
    expect(migrationSql).toContain("finance_merchants_behavior_check");
    expect(migrationSql).toContain("finance_transaction_allocations_transaction_user_fk");
    expect(migrationSql).toContain("finance_transaction_allocations_category_user_fk");
    expect(migrationSql).toContain("ADD COLUMN \"behavior\" text DEFAULT 'unknown' NOT NULL");
    expect(
      allocations.foreignKeys.map((foreignKey) => ({
        columns: foreignKey.reference().columns.map((column) => column.name),
        foreignColumns: foreignKey.reference().foreignColumns.map((column) => column.name),
        name: foreignKey.getName(),
        onDelete: foreignKey.onDelete,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          columns: ["transaction_id", "user_id"],
          foreignColumns: ["id", "user_id"],
          name: "finance_transaction_allocations_transaction_user_fk",
          onDelete: "cascade",
        },
        {
          columns: ["category_id", "user_id"],
          foreignColumns: ["id", "user_id"],
          name: "finance_transaction_allocations_category_user_fk",
          onDelete: "restrict",
        },
      ]),
    );
    const journal = JSON.parse(
      await readFile(
        resolve(process.cwd(), "packages/database/migrations/meta/_journal.json"),
        "utf8",
      ),
    ) as { entries: Array<{ tag: string }> };
    expect(journal.entries.slice(-6).map((entry) => entry.tag)).toEqual([
      "0059_finance_automation_settings",
      "0060_finance_agent_action_reviews",
      "0061_finance_transaction_allocations",
      "0062_finance_reimbursements",
      "0063_finance_maintenance_candidates",
      "0064_finance_ledger_challenges",
    ]);
  });

  it("keeps reimbursement ownership, many-to-many credit matching, and migration 0062 aligned", async () => {
    const reimbursements = getTableConfig(financeReimbursements);
    const matches = getTableConfig(financeReimbursementMatches);
    expect(reimbursements.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "user_id",
        "allocation_id",
        "expected_amount_cents",
        "received_amount_cents",
        "payer",
        "due_date",
        "evidence",
        "status",
        "revision",
      ]),
    );
    expect(matches.indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining([
        "finance_reimbursement_matches_reimbursement_credit_idx",
        "finance_reimbursement_matches_user_credit_idx",
      ]),
    );
    const migrationSql = await readFile(
      resolve(process.cwd(), "packages/database/migrations/0062_finance_reimbursements.sql"),
      "utf8",
    );
    expect(migrationSql).toContain('CREATE TABLE "finance_reimbursements"');
    expect(migrationSql).toContain('CREATE TABLE "finance_reimbursement_matches"');
    expect(migrationSql).toContain("finance_reimbursements_allocation_user_fk");
    expect(migrationSql).toContain("finance_reimbursement_matches_credit_user_fk");
  });

  it("stores bounded Finance action reviews without exposing their private payload", async () => {
    const reviews = getTableConfig(financeAgentActionReviews);
    const profiles = getTableConfig(financeProfiles);

    expect(reviews.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "id",
        "user_id",
        "requesting_agent_id",
        "source_refs",
        "action_kind",
        "private_payload",
        "safe_changes",
        "semantic_target_keys",
        "maintenance_run_id",
        "expected_revision",
        "fingerprint",
        "status",
      ]),
    );
    expect(reviews.indexes.map((index) => index.config.name)).toEqual([
      "finance_agent_action_reviews_user_status_idx",
      "finance_agent_action_reviews_pending_fingerprint_idx",
      "finance_agent_action_reviews_target_keys_idx",
    ]);
    const userStatusIndex = reviews.indexes.find(
      (index) => index.config.name === "finance_agent_action_reviews_user_status_idx",
    );
    const pendingFingerprintIndex = reviews.indexes.find(
      (index) => index.config.name === "finance_agent_action_reviews_pending_fingerprint_idx",
    );
    expect(userStatusIndex).toMatchObject({ config: { unique: false } });
    expect(
      userStatusIndex?.config.columns.map((column) => (column as { name?: string }).name),
    ).toEqual(["user_id", "status", "created_at"]);
    expect(pendingFingerprintIndex).toMatchObject({ config: { unique: true } });
    expect(
      pendingFingerprintIndex?.config.columns.map((column) => (column as { name?: string }).name),
    ).toEqual(["user_id", "fingerprint"]);
    const pendingFingerprintPredicate = pendingFingerprintIndex?.config.where;
    if (!pendingFingerprintPredicate)
      throw new Error("Finance pending fingerprint index must be partial.");
    expect(new PgDialect().sqlToQuery(pendingFingerprintPredicate).sql).toBe(
      '"finance_agent_action_reviews"."status" = \'pending\'',
    );
    expect(
      reviews.foreignKeys.map((foreignKey) => ({
        columns: foreignKey.reference().columns.map((column) => column.name),
        foreignColumns: foreignKey.reference().foreignColumns.map((column) => column.name),
        name: foreignKey.getName(),
        onDelete: foreignKey.onDelete,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          columns: ["user_id"],
          foreignColumns: ["id"],
          name: "finance_agent_action_reviews_user_id_users_id_fk",
          onDelete: "cascade",
        },
        {
          columns: ["maintenance_run_id"],
          foreignColumns: ["id"],
          name: "finance_agent_action_reviews_maintenance_run_id_workspace_maintenance_runs_id_fk",
          onDelete: "set null",
        },
      ]),
    );
    expect(profiles.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "household_size",
        "dependents",
        "housing_status",
        "monthly_housing_cost_cents",
        "reserve_target_months",
        "investment_risk_willingness",
        "investment_risk_capacity",
      ]),
    );

    const migrationSql = await readFile(
      resolve(process.cwd(), "packages/database/migrations/0060_finance_agent_action_reviews.sql"),
      "utf8",
    );
    expect(migrationSql).toContain('CREATE TABLE "finance_agent_action_reviews"');
    expect(migrationSql).toContain('"private_payload" jsonb NOT NULL');
    expect(migrationSql).toContain("\"safe_changes\" jsonb DEFAULT '[]'::jsonb NOT NULL");
    expect(migrationSql).toContain("\"semantic_target_keys\" jsonb DEFAULT '[]'::jsonb NOT NULL");
    expect(migrationSql).toContain(
      'CREATE UNIQUE INDEX "finance_agent_action_reviews_pending_fingerprint_idx" ON "finance_agent_action_reviews" USING btree ("user_id", "fingerprint") WHERE "status" = \'pending\'',
    );
    expect(migrationSql).toContain('CREATE INDEX "finance_agent_action_reviews_user_status_idx"');
    expect(migrationSql).toContain('CREATE INDEX "finance_agent_action_reviews_target_keys_idx"');
    expect(migrationSql).toContain('ADD COLUMN "household_size" integer');
    expect(migrationSql).not.toMatch(/^\s*(?:INSERT|UPDATE|DELETE)\b/mu);
    expect(migrationSql).not.toMatch(/https?:\/\//u);
  });

  it("persists one default-off Finance review bypass setting per user", async () => {
    const settings = getTableConfig(financeAutomationSettings);

    expect(settings.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["user_id", "review_bypass_enabled", "created_at", "updated_at"]),
    );
    expect(settings.columns.find((column) => column.name === "user_id")?.primary).toBe(true);

    const migrationSql = await readFile(
      resolve(process.cwd(), "packages/database/migrations/0059_finance_automation_settings.sql"),
      "utf8",
    );
    expect(migrationSql).toContain('CREATE TABLE "finance_automation_settings"');
    expect(migrationSql).toContain('"review_bypass_enabled" boolean DEFAULT false NOT NULL');
    expect(migrationSql).not.toMatch(/^\s*(?:UPDATE|DELETE\s+FROM)\b/mu);
  });

  it("keeps workspace maintenance runs durable, exclusive, and claimable", async () => {
    const runs = getTableConfig(workspaceMaintenanceRuns);
    const steps = getTableConfig(workspaceMaintenanceSteps);

    expect(runs.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "domain",
        "scope",
        "status",
        "rulebook_version",
        "source_snapshot",
        "checkpoint",
        "lease_claim_id",
        "lease_expires_at",
        "retry_at",
        "last_safe_error",
        "settled_result",
      ]),
    );
    expect(runs.indexes.map((candidate) => candidate.config.name)).toEqual(
      expect.arrayContaining([
        "workspace_maintenance_runs_open_user_domain_idx",
        "workspace_maintenance_runs_claimable_idx",
      ]),
    );
    expect(steps.indexes.map((candidate) => candidate.config.name)).toEqual(
      expect.arrayContaining([
        "workspace_maintenance_steps_run_step_idx",
        "workspace_maintenance_steps_run_idempotency_idx",
      ]),
    );
    expect(steps.columns.map((column) => column.name)).toContain("attempt_claim_id");
    expect(runs.checks.map((candidate) => candidate.name)).toContain(
      "workspace_maintenance_runs_retry_check",
    );

    const migrationSql = await readFile(
      resolve(process.cwd(), "packages/database/migrations/0056_workspace_maintenance_runs.sql"),
      "utf8",
    );
    expect(migrationSql).toContain('CREATE TABLE "workspace_maintenance_runs"');
    expect(migrationSql).toContain('CREATE TABLE "workspace_maintenance_steps"');
    expect(migrationSql).toContain(
      "WHERE \"status\" IN ('queued', 'running', 'awaiting_approval', 'blocked', 'failed_recoverable')",
    );
    expect(migrationSql).not.toMatch(/^\s*(?:UPDATE|DELETE\s+FROM)\b/mu);
    expect(migrationSql).not.toMatch(/https?:\/\//u);
  });

  it("keeps Finance synchronization health and expiring claims aligned", async () => {
    const table = getTableConfig(financeAccounts);
    expect(table.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "sync_state",
        "sync_claim_id",
        "sync_claim_expires_at",
        "last_sync_attempt_at",
        "next_sync_at",
        "sync_error",
        "sync_error_code",
        "sync_error_category",
        "sync_recovery",
        "sync_failure_count",
      ]),
    );
    expect(table.indexes.map((candidate) => candidate.config.name)).toEqual(
      expect.arrayContaining([
        "finance_accounts_sync_due_idx",
        "finance_accounts_sync_claim_idx",
        "finance_accounts_sync_initialization_idx",
      ]),
    );
    expect(table.checks.map((candidate) => candidate.name)).toEqual(
      expect.arrayContaining([
        "finance_accounts_sync_claim_check",
        "finance_accounts_sync_failure_count_check",
        "finance_accounts_sync_failure_check",
      ]),
    );

    const migrationSql = await readFile(
      resolve(process.cwd(), "packages/database/migrations/0055_finance_sync_health.sql"),
      "utf8",
    );
    expect(migrationSql).toContain("ADD COLUMN \"sync_state\" text DEFAULT 'stale' NOT NULL");
    expect(migrationSql).toContain('ADD COLUMN "sync_claim_expires_at" timestamptz');
    expect(migrationSql).toContain('CREATE INDEX "finance_accounts_sync_due_idx"');
    expect(migrationSql).toContain('CREATE INDEX "finance_accounts_sync_claim_idx"');
    expect(migrationSql).toContain('CREATE INDEX "finance_accounts_sync_initialization_idx"');
    expect(migrationSql).not.toMatch(/\bUPDATE "finance_accounts"/u);
    expect(migrationSql).not.toMatch(/https?:\/\//u);
  });

  it("keeps Provider Item synchronization authority isolated from Finance account projections", async () => {
    const items = getTableConfig(financeProviderItems);
    const accounts = getTableConfig(financeAccounts);

    expect(items.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "id",
        "user_id",
        "provider",
        "provider_item_id",
        "legacy_grouping_key",
        "encrypted_credentials",
        "sync_cursor",
        "sync_state",
        "sync_claim_id",
        "sync_claim_owner",
        "sync_claim_generation",
        "sync_claim_started_at",
        "sync_claim_expires_at",
        "last_sync_attempt_at",
        "next_sync_at",
        "sync_error",
        "sync_error_code",
        "sync_error_category",
        "sync_recovery",
        "sync_failure_count",
        "last_synced_at",
        "created_at",
        "updated_at",
      ]),
    );
    expect(items.indexes.map((candidate) => candidate.config.name)).toEqual(
      expect.arrayContaining([
        "finance_provider_items_remote_identity_idx",
        "finance_provider_items_legacy_identity_idx",
        "finance_provider_items_sync_due_idx",
        "finance_provider_items_sync_claim_recovery_idx",
      ]),
    );
    expect(items.checks.map((candidate) => candidate.name)).toEqual(
      expect.arrayContaining([
        "finance_provider_items_provider_check",
        "finance_provider_items_identity_check",
        "finance_provider_items_sync_claim_check",
        "finance_provider_items_sync_claim_generation_check",
        "finance_provider_items_sync_failure_check",
      ]),
    );
    expect(
      accounts.columns.find((column) => column.name === "provider_item_record_id"),
    ).toMatchObject({
      name: "provider_item_record_id",
      notNull: false,
    });
    expect(accounts.indexes.map((candidate) => candidate.config.name)).toContain(
      "finance_accounts_provider_item_record_id_idx",
    );
    expect(accounts.foreignKeys.map((key) => key.getName())).toContain(
      "finance_accounts_provider_item_record_id_finance_provider_items_id_fk",
    );

    const migrationSql = await readFile(
      resolve(process.cwd(), "packages/database/migrations/0058_finance_provider_items.sql"),
      "utf8",
    );
    expect(migrationSql).toContain('CREATE TABLE "finance_provider_items"');
    expect(migrationSql).toContain(
      'CREATE UNIQUE INDEX "finance_provider_items_remote_identity_idx" ON "finance_provider_items" USING btree ("user_id", "provider", "provider_item_id") WHERE "provider_item_id" IS NOT NULL',
    );
    expect(migrationSql).toContain(
      'CREATE UNIQUE INDEX "finance_provider_items_legacy_identity_idx" ON "finance_provider_items" USING btree ("user_id", "provider", "legacy_grouping_key") WHERE "legacy_grouping_key" IS NOT NULL',
    );
    expect(migrationSql).toContain("finance_provider_items_identity_check");
    expect(migrationSql).toContain("finance_provider_items_sync_claim_check");
    expect(migrationSql).toContain("finance_provider_items_sync_failure_check");
    expect(migrationSql).toContain('ADD COLUMN "provider_item_record_id" uuid');
    expect(migrationSql).toContain(
      'FOREIGN KEY ("provider_item_record_id") REFERENCES "public"."finance_provider_items"("id") ON DELETE set null',
    );
    expect(migrationSql).toContain('CREATE INDEX "finance_accounts_provider_item_record_id_idx"');
    expect(migrationSql).not.toMatch(/^\s*(?:INSERT|UPDATE|DELETE)\b/mu);
    expect(migrationSql).not.toMatch(/https?:\/\//u);
    expect(migrationSql).not.toMatch(
      /(?:access[_ -]?token|client[_ -]?secret|credential[_ -]?value)/iu,
    );
  });

  it("keeps nullable authoritative Finance currency evidence without backfilling old rows", async () => {
    const accounts = getTableConfig(financeAccounts);
    const transactions = getTableConfig(financeTransactions);
    expect(accounts.columns.map((column) => column.name)).toContain("currency_code");
    expect(transactions.columns.map((column) => column.name)).toContain("currency_code");
    expect(accounts.checks.map((candidate) => candidate.name)).toContain(
      "finance_accounts_currency_code_check",
    );
    expect(transactions.checks.map((candidate) => candidate.name)).toContain(
      "finance_transactions_currency_code_check",
    );

    const migrationSql = await readFile(
      resolve(process.cwd(), "packages/database/migrations/0057_finance_currency_evidence.sql"),
      "utf8",
    );
    expect(migrationSql).toContain('ADD COLUMN "currency_code" text');
    expect(migrationSql).toContain("finance_accounts_currency_code_check");
    expect(migrationSql).toContain("finance_transactions_currency_code_check");
    expect(migrationSql).not.toMatch(/^\s*(?:UPDATE|DELETE\s+FROM)\b/mu);
    expect(migrationSql).not.toMatch(/\bDEFAULT\b/u);
  });

  it("keeps connector notification storage bounded and coalesced", async () => {
    const subscriptions = getTableConfig(connectorSubscriptions);
    const triggers = getTableConfig(connectorSyncTriggers);
    expect(subscriptions.indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining([
        "connector_subscriptions_identity_idx",
        "connector_subscriptions_channel_idx",
        "connector_subscriptions_due_idx",
      ]),
    );
    expect(triggers.indexes.map((index) => index.config.name)).toContain(
      "connector_sync_triggers_due_idx",
    );
    expect(triggers.checks.map((constraint) => constraint.name)).toEqual(
      expect.arrayContaining([
        "connector_sync_triggers_reason_check",
        "connector_sync_triggers_count_check",
        "connector_sync_triggers_time_check",
        "connector_sync_triggers_claim_check",
      ]),
    );
    expect(calendarAccounts.mailSyncToken.name).toBe("mail_sync_token");
    const migrationSql = await readFile(
      resolve(process.cwd(), "packages/database/migrations/0052_connector_notifications.sql"),
      "utf8",
    );
    expect(migrationSql).toContain("NULLS NOT DISTINCT");
    expect(migrationSql).toContain("ON DELETE cascade");
    expect(migrationSql).toContain('"notification_count" BETWEEN 1 AND 1000000');
  });

  it("keeps approval snapshot integrity identical in the schema and migration", async () => {
    const check = getTableConfig(domainProfileApprovals).checks.find(
      (candidate) => candidate.name === "domain_profile_approvals_snapshot_check",
    );
    if (!check) throw new Error("Approval snapshot check is missing from the canonical schema.");
    const schemaSql = new PgDialect().sqlToQuery(check.value).sql;
    const migrationSql = await readFile(
      resolve(process.cwd(), "packages/database/migrations/0041_domain_profile_approvals.sql"),
      "utf8",
    );

    expect(schemaSql).toContain(
      `AND "domain_profile_approvals"."profile"->>'status' = 'active') IS TRUE`,
    );
    expect(migrationSql).toContain(`AND "profile"->>'status' = 'active'\n\t\t\t) IS TRUE`);
  });

  it("keeps the Finance setup checkpoint in its own schema expansion", async () => {
    const approvalMigration = await readFile(
      resolve(process.cwd(), "packages/database/migrations/0041_domain_profile_approvals.sql"),
      "utf8",
    );
    const checkpointMigration = await readFile(
      resolve(process.cwd(), "packages/database/migrations/0043_finance_setup_backfill_state.sql"),
      "utf8",
    );

    expect(approvalMigration).not.toContain("finance_setup_backfill_state");
    expect(checkpointMigration).toContain('CREATE TABLE "finance_setup_backfill_state"');
    expect(checkpointMigration).toContain('"categories_complete" boolean DEFAULT false NOT NULL');
    expect(checkpointMigration).toContain('"profiles_complete" boolean DEFAULT false NOT NULL');
  });

  it("keeps durable Mail work claims and migration indexes aligned", async () => {
    const table = getTableConfig(mailRuleWorkItems);
    const claimCheck = table.checks.find(
      (candidate) => candidate.name === "mail_rule_work_claim_state_check",
    );
    if (!claimCheck) throw new Error("Durable Mail work claim check is missing.");
    const fingerprintCheck = table.checks.find(
      (candidate) => candidate.name === "mail_rule_work_action_fingerprint_check",
    );
    if (!fingerprintCheck) throw new Error("Durable Mail work fingerprint check is missing.");
    const providerEffectCheck = table.checks.find(
      (candidate) => candidate.name === "mail_rule_work_provider_effect_check",
    );
    if (!providerEffectCheck)
      throw new Error("Durable Mail work provider-effect check is missing.");
    const schemaSql = new PgDialect().sqlToQuery(claimCheck.value).sql;
    const fingerprintSql = new PgDialect().sqlToQuery(fingerprintCheck.value).sql;
    const providerEffectSql = new PgDialect().sqlToQuery(providerEffectCheck.value).sql;
    const migrationSql = await readFile(
      resolve(process.cwd(), "packages/database/migrations/0044_durable_mail_rule_work.sql"),
      "utf8",
    );
    expect(schemaSql).toContain(`"mail_rule_work_items"."status" = 'claimed'`);
    expect(schemaSql).toContain(`"mail_rule_work_items"."claim_id" IS NOT NULL`);
    expect(fingerprintSql).toContain(`~ '^[0-9a-f]{64}$'`);
    expect(providerEffectSql).toContain(`'indeterminate'`);
    expect(providerEffectSql).toContain(`'applied'`);
    expect(migrationSql).toContain('CREATE UNIQUE INDEX "mail_rule_work_identity_idx"');
    expect(migrationSql).toContain('"rule_version",\n\t\t"profile_version"');
    expect(migrationSql).toContain('CREATE INDEX "mail_rule_work_due_idx"');
    expect(migrationSql).toContain('CREATE INDEX "mail_rule_work_thread_status_idx"');
    expect(migrationSql).toContain('CREATE INDEX "mail_rule_work_user_status_idx"');
    expect(migrationSql).toContain('"attempt_count" >= 0 AND "attempt_count" <= 5');
    expect(migrationSql).toContain("\"status\" IN ('succeeded', 'failed')");
  });

  it("keeps Mail-to-Calendar source identity and preview-only intake aligned", async () => {
    const table = getTableConfig(mailCalendarCommitmentIntakes);
    const fingerprintCheck = table.checks.find(
      (candidate) => candidate.name === "mail_calendar_commitment_intake_source_fingerprint_check",
    );
    if (!fingerprintCheck) throw new Error("Commitment intake fingerprint check is missing.");
    const accountAddressCheck = table.checks.find(
      (candidate) =>
        candidate.name === "mail_calendar_commitment_intake_account_address_hint_hash_check",
    );
    if (!accountAddressCheck)
      throw new Error("Commitment intake account-address check is missing.");
    const authorityStatusCheck = table.checks.find(
      (candidate) => candidate.name === "mail_calendar_commitment_intake_authority_status_check",
    );
    if (!authorityStatusCheck)
      throw new Error("Commitment intake authority/status check is missing.");
    const schemaSql = new PgDialect().sqlToQuery(fingerprintCheck.value).sql;
    const accountAddressSql = new PgDialect().sqlToQuery(accountAddressCheck.value).sql;
    const authorityStatusSql = new PgDialect().sqlToQuery(authorityStatusCheck.value).sql;
    const migrationSql = await readFile(
      resolve(
        process.cwd(),
        "packages/database/migrations/0045_mail_calendar_commitment_intake.sql",
      ),
      "utf8",
    );
    const renameMigrationSql = await readFile(
      resolve(process.cwd(), "packages/database/migrations/0046_mail_calendar_account_hint.sql"),
      "utf8",
    );
    const uidValidityMigrationSql = await readFile(
      resolve(process.cwd(), "packages/database/migrations/0047_icloud_uidvalidity_identity.sql"),
      "utf8",
    );
    expect(schemaSql).toContain(`"idempotency_key" ~ '^[0-9a-f]{64}$'`);
    expect(accountAddressSql).toContain(`"provider_account_address_hint_hash" IS NULL`);
    expect(renameMigrationSql).toContain(
      'RENAME COLUMN "authenticated_account_address_hash" TO "provider_account_address_hint_hash"',
    );
    expect(renameMigrationSql).toContain(
      'DELETE FROM "mail_calendar_commitment_intakes" AS "intake"',
    );
    expect(renameMigrationSql).toContain('DELETE FROM "mail_messages" AS "message"');
    expect(renameMigrationSql).toContain(`"account"."provider" = 'icloud'`);
    expect(uidValidityMigrationSql).toContain(
      'DELETE FROM "mail_calendar_commitment_intakes" AS "intake"',
    );
    expect(uidValidityMigrationSql).toContain(
      'ALTER TABLE "mailboxes" ADD COLUMN "provider_revision" text',
    );
    expect(uidValidityMigrationSql).toContain('UPDATE "mail_threads" AS "thread"');
    expect(uidValidityMigrationSql).toContain('"deleted_at" = CURRENT_TIMESTAMP');
    expect(uidValidityMigrationSql).not.toContain('DELETE FROM "mail_threads" AS "thread"');
    expect(authorityStatusSql).toContain(`"authority" <> 'provider_projected_unverified'`);
    expect(renameMigrationSql).toContain("\"authority\" <> 'provider_projected_unverified'");
    expect(migrationSql).toContain('"provider_mailbox_ids" jsonb');
    expect(migrationSql).toContain('"provider_revision" text');
    expect(migrationSql).toContain('"source_message_mailbox_ids" jsonb');
    expect(migrationSql).toContain('"source_message_revision" text');
    expect(migrationSql).toContain(
      'CREATE UNIQUE INDEX "mail_calendar_commitment_intake_identity_idx"',
    );
    expect(migrationSql).toContain('"account_id",\n\t\t"remote_message_id",\n\t\t"remote_part_id"');
    expect(migrationSql).toContain(
      "\"authority\" IN ('provider_projected_unverified', 'server_verified')",
    );
    expect(migrationSql).toContain(
      "\"status\" IN ('preview_only', 'pending', 'claimed', 'reconcile', 'succeeded', 'failed')",
    );
  });

  it("keeps connector sync generation and claim state aligned", async () => {
    const table = getTableConfig(calendarAccounts);
    const generationCheck = table.checks.find(
      (candidate) => candidate.name === "calendar_accounts_sync_generation_check",
    );
    const claimCheck = table.checks.find(
      (candidate) => candidate.name === "calendar_accounts_sync_claim_check",
    );
    if (!generationCheck || !claimCheck) {
      throw new Error("Connector sync generation checks are missing.");
    }
    const generationSql = new PgDialect().sqlToQuery(generationCheck.value).sql;
    const claimSql = new PgDialect().sqlToQuery(claimCheck.value).sql;
    const migrationSql = await readFile(
      resolve(process.cwd(), "packages/database/migrations/0048_connector_sync_generation.sql"),
      "utf8",
    );

    expect(generationSql).toContain(`"calendar_accounts"."sync_generation" >= 0`);
    expect(claimSql).toContain(`"calendar_accounts"."sync_status" = 'syncing'`);
    expect(claimSql).toContain(`"calendar_accounts"."sync_claim_id" IS NOT NULL`);
    expect(migrationSql).toContain('ADD COLUMN "sync_generation" integer DEFAULT 0 NOT NULL');
    expect(migrationSql).toContain('ADD COLUMN "sync_claim_id" uuid');
    expect(migrationSql).toContain(`WHERE "sync_status" = 'syncing'`);
  });

  it("stores typed connector health and safely backfills legacy failures", async () => {
    const table = getTableConfig(calendarAccounts);
    expect(table.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "sync_error_code",
        "sync_error_category",
        "sync_recovery",
        "sync_failure_count",
        "last_sync_attempt_at",
        "next_sync_at",
      ]),
    );
    expect(table.indexes.map((candidate) => candidate.config.name)).toContain(
      "calendar_accounts_sync_due_idx",
    );
    expect(table.checks.map((candidate) => candidate.name)).toEqual(
      expect.arrayContaining([
        "calendar_accounts_sync_failure_count_check",
        "calendar_accounts_sync_recovery_check",
      ]),
    );

    const migrationSql = await readFile(
      resolve(process.cwd(), "packages/database/migrations/0050_connector_sync_health.sql"),
      "utf8",
    );
    expect(migrationSql).toContain('ADD COLUMN "sync_error_code" text');
    expect(migrationSql).toContain('ADD COLUMN "sync_error_category" text');
    expect(migrationSql).toContain('ADD COLUMN "sync_recovery" text');
    expect(migrationSql).toContain('ADD COLUMN "sync_failure_count" integer DEFAULT 0 NOT NULL');
    expect(migrationSql).toContain('ADD COLUMN "last_sync_attempt_at" timestamptz');
    expect(migrationSql).toContain('ADD COLUMN "next_sync_at" timestamptz');
    expect(migrationSql).toContain(
      "This connection was interrupted. ilo will retry automatically.",
    );
    expect(migrationSql).toContain("'legacy_sync_failure'");
    expect(migrationSql).toContain("'automatic'");
    expect(migrationSql).toContain('"sync_failure_count" = 1');
    expect(migrationSql).toContain('"next_sync_at" = NOW()');
    expect(migrationSql).not.toMatch(/"sync_error_code"\s*=\s*"sync_error"/u);
    expect(migrationSql).not.toMatch(/"sync_error_category"\s*=\s*"sync_error"/u);
    expect(migrationSql).not.toMatch(/"sync_recovery"\s*=\s*"sync_error"/u);
  });

  it("keeps connector authorization attempt lifecycle aligned with its migration", async () => {
    const table = getTableConfig(oauthStates);
    expect(table.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "status",
        "outcome_code",
        "connected_account_id",
        "redirect_uri",
        "completed_at",
        "request_id",
      ]),
    );
    expect(table.indexes.map((candidate) => candidate.config.name)).toEqual(
      expect.arrayContaining([
        "oauth_states_expiry_idx",
        "oauth_states_status_expiry_idx",
        "oauth_states_user_created_idx",
      ]),
    );
    expect(table.checks.map((candidate) => candidate.name)).toEqual(
      expect.arrayContaining(["oauth_states_status_check", "oauth_states_lifecycle_check"]),
    );

    const migrationSql = await readFile(
      resolve(
        process.cwd(),
        "packages/database/migrations/0051_connector_authorization_attempts.sql",
      ),
      "utf8",
    );
    expect(migrationSql).toContain("ADD COLUMN \"status\" text DEFAULT 'pending' NOT NULL");
    expect(migrationSql).toContain("\"outcome_code\" = 'legacy_consumed'");
    expect(migrationSql).toContain('"completed_at" = "consumed_at"');
    expect(migrationSql).toContain('CREATE INDEX "oauth_states_status_expiry_idx"');
    expect(migrationSql).toContain('CREATE INDEX "oauth_states_user_created_idx"');
    const expiryIndexMigration = await readFile(
      resolve(process.cwd(), "packages/database/migrations/0053_oauth_states_expiry_index.sql"),
      "utf8",
    );
    expect(expiryIndexMigration).toContain('CREATE INDEX "oauth_states_expiry_idx"');
  });
});
