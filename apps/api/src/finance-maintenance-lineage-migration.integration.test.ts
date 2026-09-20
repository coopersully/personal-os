import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createDatabaseClient, migrateDatabase } from "@personal-os/database";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { migrationsWithout } from "./test-migrations.js";

const migrationsFolder = resolve(process.cwd(), "packages/database/migrations");
const migrationTag = "0082_finance_maintenance_lineage";

describe.sequential("Finance maintenance lineage migration", () => {
  it("preserves historical work and effects and enforces tenant-owned canonical links", async () => {
    const container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    const database = createDatabaseClient(container.getConnectionUri());
    const beforeLineage = await migrationsWithout(migrationsFolder, "nohmi-maintenance-lineage-", [
      migrationTag,
      "0083_global_execution_policy",
      "0084_finance_setup_profile_lineage",
      "0085_finance_context_capture",
      "0086_notification_foundation",
    ]);
    try {
      await migrateDatabase(database.db, beforeLineage);
      const ownerId = crypto.randomUUID();
      const foreignId = crypto.randomUUID();
      const runId = crypto.randomUUID();
      const accountId = crypto.randomUUID();
      const transactionId = crypto.randomUUID();
      const eventId = crypto.randomUUID();
      const setupId = crypto.randomUUID();
      const scope = { type: "since", date: "2026-08-01" };
      await database.pool.query(
        `INSERT INTO users (id, email, password_hash, display_name)
        VALUES ($1, 'lineage-owner@example.com', 'unused', 'Lineage owner'),
               ($2, 'lineage-foreign@example.com', 'unused', 'Foreign owner')`,
        [ownerId, foreignId],
      );
      await database.pool.query(
        `INSERT INTO finance_maintenance_runs (id, user_id, stage, scope, version)
        VALUES ($1, $2, 'agent_audit', $3, 7)`,
        [runId, ownerId, scope],
      );
      for (const stage of [
        "deterministic_processing",
        "agent_reasoning",
        "reconciliation",
        "settled",
        "failed",
      ]) {
        await database.pool.query(
          `INSERT INTO finance_maintenance_runs (user_id, stage, scope, version, error, settled_at)
          VALUES ($1, $2, $3, 3, $4, $5)`,
          [
            ownerId,
            stage,
            scope,
            stage === "failed"
              ? { code: "historic_failure", message: "Keep original failure" }
              : null,
            stage === "settled" ? "2026-08-20T12:00:00Z" : null,
          ],
        );
      }
      await database.pool.query(
        `INSERT INTO finance_accounts (id, user_id, institution, name, provider)
        VALUES ($1, $2, 'Fixture Bank', 'Historical account', 'manual')`,
        [accountId, ownerId],
      );
      await database.pool.query(
        `INSERT INTO finance_transactions
        (id, user_id, account_id, merchant, amount_cents, direction, transaction_date, category, category_source, needs_review)
        VALUES ($1, $2, $3, 'Historical purchase', 1250, 'expense', '2026-08-17', 'Groceries', 'agent', false)`,
        [transactionId, ownerId, accountId],
      );
      await database.pool.query(
        `INSERT INTO finance_economic_events (id, user_id, kind, stable_key)
        VALUES ($1, $2, 'purchase', 'historic-event')`,
        [eventId, ownerId],
      );
      await database.pool.query(
        `INSERT INTO finance_event_transactions (user_id, economic_event_id, transaction_id)
        VALUES ($1, $2, $3)`,
        [ownerId, eventId, transactionId],
      );
      await database.pool.query(
        `INSERT INTO finance_maintenance_judgments
        (user_id, run_id, judgment_key, type, payload, provenance)
        VALUES ($1, $2, 'historic-judgment', 'classify_transaction', $3, $4)`,
        [
          ownerId,
          runId,
          { transactionId, category: "Groceries", rationale: "Historical evidence" },
          { source: "historic-agent", revision: "original" },
        ],
      );
      await database.pool.query(
        `INSERT INTO finance_audit_findings
        (user_id, run_id, economic_event_id, stable_key, reason_code, evidence, impact_amount_cents, rationale)
        VALUES ($1, $2, $3, 'historic-finding', 'needs_review', $4, 1250, 'Keep original finding')`,
        [ownerId, runId, eventId, { transactionId, revision: "original" }],
      );
      await database.pool.query(
        `INSERT INTO finance_mutation_records
        (user_id, idempotency_key, operation, request_hash, actor_type, actor_id, status, response, completed_at)
        VALUES ($1, 'historic-effect', 'classify_transaction', 'historic-request', 'agent', 'historic-agent', 'completed', $2, '2026-08-20T12:00:00Z')`,
        [ownerId, { transactionId, category: "Groceries" }],
      );
      await database.pool.query(
        `INSERT INTO finance_setup_sessions
        (id, user_id, status, maintenance_run_id, current_question_key, version)
        VALUES ($1, $2, 'initial_maintenance', $3, 'historic-question', 5)`,
        [setupId, ownerId, runId],
      );

      async function historicalRows() {
        const result: Record<string, unknown> = {};
        for (const table of [
          "finance_maintenance_runs",
          "finance_maintenance_judgments",
          "finance_audit_findings",
          "finance_mutation_records",
          "finance_accounts",
          "finance_transactions",
          "finance_economic_events",
          "finance_event_transactions",
          "finance_setup_sessions",
        ]) {
          result[table] = (
            await database.pool.query(
              `SELECT to_jsonb(row) - 'canonical_run_id' - 'canonical_maintenance_run_id' - 'recovery' - 'skipped_questions' - 'question_profile_version_id' - 'proposal_profile_version_id' AS record FROM ${table} AS row ORDER BY id`,
            )
          ).rows;
        }
        return result;
      }
      const before = await historicalRows();
      await migrateDatabase(database.db, migrationsFolder);
      expect(await historicalRows()).toEqual(before);
      await expect(
        database.pool.query(
          `SELECT canonical_run_id, recovery FROM finance_maintenance_runs WHERE id = $1`,
          [runId],
        ),
      ).resolves.toMatchObject({ rows: [{ canonical_run_id: null, recovery: null }] });
      await expect(
        database.pool.query(
          `SELECT maintenance_run_id, canonical_maintenance_run_id, status FROM finance_setup_sessions WHERE id = $1`,
          [setupId],
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            maintenance_run_id: runId,
            canonical_maintenance_run_id: null,
            status: "initial_maintenance",
          },
        ],
      });

      const canonicalId = crypto.randomUUID();
      const foreignCanonicalId = crypto.randomUUID();
      await database.pool.query(
        `INSERT INTO workspace_maintenance_runs (id, user_id, domain, scope, rulebook_version)
        VALUES ($1, $2, 'finances', '{"type":"all_outstanding"}', 'historic-rulebook'),
               ($3, $4, 'finances', '{"type":"all_outstanding"}', 'historic-rulebook')`,
        [canonicalId, ownerId, foreignCanonicalId, foreignId],
      );
      const recovery = {
        legacyRunId: runId,
        state: "adopted",
        originalStage: "agent_audit",
        originalScope: scope,
        throughDate: "2026-08-21",
        reason: "Reviewed scoped adoption",
      };
      await expect(
        database.pool.query(
          `UPDATE finance_maintenance_runs SET canonical_run_id = $1, stage = 'superseded', recovery = $2 WHERE id = $3`,
          [foreignCanonicalId, recovery, runId],
        ),
      ).rejects.toMatchObject({
        code: "23503",
        constraint: "finance_maintenance_runs_canonical_user_fk",
      });
      await expect(
        database.pool.query(
          `UPDATE finance_setup_sessions SET canonical_maintenance_run_id = $1 WHERE id = $2`,
          [foreignCanonicalId, setupId],
        ),
      ).rejects.toMatchObject({
        code: "23503",
        constraint: "finance_setup_sessions_canonical_user_fk",
      });
      await expect(
        database.pool.query(
          `UPDATE finance_maintenance_runs SET canonical_run_id = $1, stage = 'superseded', recovery = '{}' WHERE id = $2`,
          [canonicalId, runId],
        ),
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "finance_maintenance_runs_recovery_check",
      });
      await database.pool.query(
        `UPDATE finance_maintenance_runs SET canonical_run_id = $1, stage = 'superseded', recovery = $2 WHERE id = $3`,
        [canonicalId, recovery, runId],
      );
      await database.pool.query(
        `UPDATE finance_setup_sessions SET canonical_maintenance_run_id = $1 WHERE id = $2`,
        [canonicalId, setupId],
      );
      await expect(
        database.pool.query(
          `SELECT stage, scope, version, canonical_run_id, recovery FROM finance_maintenance_runs WHERE id = $1`,
          [runId],
        ),
      ).resolves.toMatchObject({
        rows: [{ stage: "superseded", scope, version: 7, canonical_run_id: canonicalId, recovery }],
      });
      await expect(
        database.pool.query(
          `SELECT maintenance_run_id, canonical_maintenance_run_id, status FROM finance_setup_sessions WHERE id = $1`,
          [setupId],
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            maintenance_run_id: runId,
            canonical_maintenance_run_id: canonicalId,
            status: "initial_maintenance",
          },
        ],
      });
      const afterLink = await historicalRows();
      for (const table of Object.keys(before).filter(
        (table) => table !== "finance_maintenance_runs",
      ))
        expect(afterLink[table]).toEqual(before[table]);
    } finally {
      await database.close();
      await container.stop();
      await rm(beforeLineage, { force: true, recursive: true });
    }
  }, 120_000);
});
