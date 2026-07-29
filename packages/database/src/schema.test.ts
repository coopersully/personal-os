import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import {
  calendarAccounts,
  domainProfileApprovals,
  mailCalendarCommitmentIntakes,
  mailRuleWorkItems,
} from "./schema.js";

describe("database schema contracts", () => {
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
    expect(uidValidityMigrationSql).toContain('DELETE FROM "mail_threads" AS "thread"');
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
});
