import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import {
  calendarAccounts,
  connectorSubscriptions,
  connectorSyncTriggers,
  domainProfileApprovals,
  financeAccounts,
  mailCalendarCommitmentIntakes,
  mailRuleWorkItems,
  oauthStates,
  workspaceMaintenanceRuns,
  workspaceMaintenanceSteps,
} from "./schema.js";

describe("database schema contracts", () => {
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
