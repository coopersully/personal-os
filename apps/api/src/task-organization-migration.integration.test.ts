import { access, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createDatabaseClient, type DatabaseClient, migrateDatabase } from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { migrationsWithout } from "./test-migrations.js";

const migrationsFolder = resolve(process.cwd(), "packages/database/migrations");
const migrationPath = resolve(migrationsFolder, "0055_task_organization.sql");
const reconciliationMigration = "0059_task_organization_reconciliation";
const finalReconciliationMigration = "0073_task_organization_reconciliation";
const migrationsAfterTaskOrganization = [
  "0072_finance_account_semantics",
  "0072_texting",
  "0073_texting_review_hardening",
  "0073_finance_account_semantics_recovery",
  "0074_finance_budget_buckets",
  "0075_finance_ownership_constraint",
];

function databaseUri(connectionUri: string, databaseName: string): string {
  const uri = new URL(connectionUri);
  uri.pathname = `/${databaseName}`;
  return uri.toString();
}

async function requireTaskOrganizationMigration(): Promise<void> {
  const exists = await access(migrationPath).then(
    () => true,
    () => false,
  );
  expect(exists, "0055_task_organization.sql must exist before migration behavior can pass").toBe(
    true,
  );
}

describe.sequential("Task organization migration", () => {
  let container: StartedPostgreSqlContainer;
  let admin: DatabaseClient;
  const clients: DatabaseClient[] = [];
  const temporaryMigrationFolders: string[] = [];

  async function createIsolatedDatabase(name: string): Promise<DatabaseClient> {
    await admin.pool.query(`CREATE DATABASE "${name}"`);
    const client = createDatabaseClient(databaseUri(container.getConnectionUri(), name));
    clients.push(client);
    return client;
  }

  async function migrationsBeforeTaskOrganization(prefix: string): Promise<string> {
    const folder = await migrationsWithout(migrationsFolder, prefix, [
      "0055_task_organization",
      "0055_finance_sync_health",
      "0056_workspace_maintenance_runs",
      "0057_finance_currency_evidence",
      "0058_finance_provider_items",
      reconciliationMigration,
      "0059_finance_automation_settings",
      "0060_finance_agent_action_reviews",
      "0061_finance_transaction_allocations",
      "0062_finance_reimbursements",
      "0063_finance_maintenance_candidates",
      "0064_finance_ledger_challenges",
      "0065_finance_period_reviews",
      "0066_finance_plan_versions",
      "0067_finance_ledger_protocol",
      "0068_finance_mutation_leases",
      "0069_finance_legacy_budget_backfill",
      "0070_calendar_stewardship_foundations",
      "0071_calendar_event_links",
      "0072_finance_parallel_migration_reconciliation",
      finalReconciliationMigration,
      ...migrationsAfterTaskOrganization,
    ]);
    temporaryMigrationFolders.push(folder);
    return folder;
  }

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine")
      .withDatabase("personal_os")
      .withUsername("personal_os")
      .withPassword("personal_os")
      .start();
    admin = createDatabaseClient(container.getConnectionUri());
  }, 120_000);

  afterAll(async () => {
    for (const client of clients) await client.close();
    await admin?.close();
    await container?.stop();
    for (const folder of temporaryMigrationFolders) {
      await rm(folder, { force: true, recursive: true });
    }
  });

  it("enforces Inbox, name, ownership, lifecycle, and kind integrity after a fresh migration", async () => {
    await requireTaskOrganizationMigration();
    const database = await createIsolatedDatabase("task_organization_fresh");
    await migrateDatabase(database.db, migrationsFolder);

    const insertedUser = await database.pool.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, display_name)
       VALUES ('fresh-task-user@example.com', 'unused', 'Fresh Task User')
       RETURNING id`,
    );
    const userId = insertedUser.rows[0]?.id;
    if (!userId) throw new Error("Fresh migration user was not inserted.");

    const inboxes = await database.pool.query<{
      availability: string;
      kind: string;
      name: string;
      normalized_name: string;
      revision: number;
    }>(
      `SELECT kind, name, normalized_name, availability, revision
       FROM task_lists
       WHERE user_id = $1`,
      [userId],
    );
    expect(inboxes.rows).toEqual([
      {
        availability: "active",
        kind: "inbox",
        name: "Inbox",
        normalized_name: "inbox",
        revision: 1,
      },
    ]);

    await expect(
      database.pool.query(
        `INSERT INTO task_lists (user_id, kind, name, normalized_name)
         VALUES ($1, 'inbox', 'Another Inbox', 'another inbox')`,
        [userId],
      ),
    ).rejects.toThrow();
    for (const invalidListInsert of [
      `INSERT INTO task_lists (user_id, kind, name, normalized_name)
       VALUES ($1, 'computed', 'Invalid kind', 'invalid kind')`,
      `INSERT INTO task_lists (user_id, name, normalized_name, availability)
       VALUES ($1, 'Invalid availability', 'invalid availability', 'paused')`,
      `INSERT INTO task_lists (user_id, name, normalized_name, revision)
       VALUES ($1, 'Invalid revision', 'invalid revision', 0)`,
    ]) {
      await expect(database.pool.query(invalidListInsert, [userId])).rejects.toThrow();
    }
    await expect(
      database.pool.query(
        `UPDATE task_lists SET name = 'Renamed' WHERE user_id = $1 AND kind = 'inbox'`,
        [userId],
      ),
    ).rejects.toThrow(/system Inbox is immutable/u);
    await expect(
      database.pool.query(`DELETE FROM task_lists WHERE user_id = $1 AND kind = 'inbox'`, [userId]),
    ).rejects.toThrow(/system Inbox is immutable/u);

    await database.pool.query(
      `INSERT INTO task_lists (
         user_id, kind, name, normalized_name, availability, archived_at
       ) VALUES ($1, 'standard', 'Plans', 'plans', 'archived', NOW())`,
      [userId],
    );
    await expect(
      database.pool.query(
        `INSERT INTO task_lists (user_id, kind, name, normalized_name)
         VALUES ($1, 'standard', '  PLANS  ', 'plans')`,
        [userId],
      ),
    ).rejects.toThrow();
    await database.pool.query(
      `UPDATE task_lists SET deleted_at = NOW() WHERE user_id = $1 AND normalized_name = 'plans'`,
      [userId],
    );
    const replacementList = await database.pool.query<{ id: string }>(
      `INSERT INTO task_lists (user_id, kind, name, normalized_name)
       VALUES ($1, 'standard', 'Plans again', 'plans')
       RETURNING id`,
      [userId],
    );
    const replacementListId = replacementList.rows[0]?.id;
    if (!replacementListId) throw new Error("Replacement List was not inserted.");
    await expect(
      database.pool.query(
        `INSERT INTO task_lists (
           user_id, kind, name, normalized_name, create_idempotency_key
         ) VALUES ($1, 'standard', 'Invalid retry', 'invalid retry', $2)`,
        [userId, "40000000-0000-4000-8000-000000000001"],
      ),
    ).rejects.toThrow();

    const secondUser = await database.pool.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, display_name)
       VALUES ('second-task-user@example.com', 'unused', 'Second Task User')
       RETURNING id`,
    );
    const secondUserId = secondUser.rows[0]?.id;
    if (!secondUserId) throw new Error("Second Task user was not inserted.");
    const secondInbox = await database.pool.query<{ id: string }>(
      `SELECT id FROM task_lists WHERE user_id = $1 AND kind = 'inbox'`,
      [secondUserId],
    );
    const secondInboxId = secondInbox.rows[0]?.id;
    if (!secondInboxId) throw new Error("Second Task user did not receive an Inbox.");

    await expect(
      database.pool.query(
        `INSERT INTO task_projects (user_id, list_id, name, normalized_name)
         VALUES ($1, $2, 'Cross-owner Project', 'cross-owner project')`,
        [secondUserId, replacementListId],
      ),
    ).rejects.toThrow();
    const project = await database.pool.query<{ id: string }>(
      `INSERT INTO task_projects (user_id, list_id, name, normalized_name)
       VALUES ($1, $2, 'Launch', 'launch')
       RETURNING id`,
      [userId, replacementListId],
    );
    const projectId = project.rows[0]?.id;
    if (!projectId) throw new Error("Task Project was not inserted.");
    for (const [column, value] of [
      ["lifecycle", "paused"],
      ["availability", "paused"],
      ["revision", "0"],
    ]) {
      await expect(
        database.pool.query(
          `INSERT INTO task_projects (
             user_id, list_id, name, normalized_name, ${column}
           ) VALUES ($1, $2, $3, $4, $5)`,
          [userId, replacementListId, `Invalid ${column}`, `invalid ${column}`, value],
        ),
      ).rejects.toThrow();
    }
    await database.pool.query(
      `UPDATE task_projects
       SET availability = 'archived', archived_at = NOW()
       WHERE id = $1`,
      [projectId],
    );
    await expect(
      database.pool.query(
        `INSERT INTO task_projects (user_id, list_id, name, normalized_name)
         VALUES ($1, $2, 'LAUNCH', 'launch')`,
        [userId, replacementListId],
      ),
    ).rejects.toThrow();
    await expect(
      database.pool.query(
        `INSERT INTO reminders (
           user_id, title, kind, status, task_list_id, task_lifecycle, task_revision
         ) VALUES ($1, 'Invalid legacy status Task', 'task', 'paused', $2, 'open', 1)`,
        [userId, replacementListId],
      ),
    ).rejects.toThrow();
    await expect(
      database.pool.query(
        `INSERT INTO reminders (
           user_id, title, kind, task_list_id, task_lifecycle, task_revision
         ) VALUES ($1, 'Invalid lifecycle Task', 'task', $2, 'paused', 1)`,
        [userId, replacementListId],
      ),
    ).rejects.toThrow();
    await expect(
      database.pool.query(
        `INSERT INTO reminders (
           user_id, title, kind, task_list_id, task_lifecycle, task_revision
         ) VALUES ($1, 'Invalid revision Task', 'task', $2, 'open', 0)`,
        [userId, replacementListId],
      ),
    ).rejects.toThrow();
    await database.pool.query(`UPDATE task_projects SET deleted_at = NOW() WHERE id = $1`, [
      projectId,
    ]);
    await expect(
      database.pool.query(
        `INSERT INTO task_projects (user_id, list_id, name, normalized_name)
         VALUES ($1, $2, 'Launch again', 'launch')`,
        [userId, replacementListId],
      ),
    ).resolves.toBeDefined();

    await expect(
      database.pool.query(
        `INSERT INTO reminders (
           user_id, title, kind, task_list_id, task_lifecycle, task_revision
         ) VALUES ($1, 'Valid canonical Task', 'task', $2, 'open', 1)`,
        [userId, replacementListId],
      ),
    ).resolves.toBeDefined();
    await expect(
      database.pool.query(
        `INSERT INTO reminders (user_id, title, kind)
         VALUES ($1, 'Task missing organization', 'task')`,
        [userId],
      ),
    ).rejects.toThrow();
    await expect(
      database.pool.query(
        `INSERT INTO reminders (user_id, title, kind, task_list_id)
         VALUES ($1, 'Contaminated Reminder', 'reminder', $2)`,
        [userId, replacementListId],
      ),
    ).rejects.toThrow();
    await expect(
      database.pool.query(
        `INSERT INTO reminders (
           user_id, title, kind, task_list_id, task_lifecycle, task_revision
         ) VALUES ($1, 'Cross-owner Task', 'task', $2, 'open', 1)`,
        [userId, secondInboxId],
      ),
    ).rejects.toThrow();
    await expect(
      database.pool.query(
        `INSERT INTO reminders (
           user_id, title, kind, task_list_id, task_project_id, task_lifecycle, task_revision
         )
         SELECT $1, 'Cross-List Project Task', 'task', inbox.id, $2, 'open', 1
         FROM task_lists AS inbox
         WHERE inbox.user_id = $1 AND inbox.kind = 'inbox'`,
        [userId, projectId],
      ),
    ).rejects.toThrow();
    await expect(
      database.pool.query(
        `INSERT INTO reminders (user_id, title, priority)
         VALUES ($1, 'Invalid priority Reminder', 'urgent')`,
        [userId],
      ),
    ).rejects.toThrow();

    await database.pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    const remainingLists = await database.pool.query<{ count: string }>(
      `SELECT count(*) FROM task_lists WHERE user_id = $1`,
      [userId],
    );
    expect(remainingLists.rows[0]?.count).toBe("0");
  });

  it("reconciles Task organization after the parallel Finance migration was already applied", async () => {
    const database = await createIsolatedDatabase("task_organization_parallel_0055");
    const financeHistory = await migrationsWithout(
      migrationsFolder,
      "ilo-task-organization-parallel-0055-",
      [
        "0055_task_organization",
        reconciliationMigration,
        finalReconciliationMigration,
        ...migrationsAfterTaskOrganization,
      ],
    );
    temporaryMigrationFolders.push(financeHistory);
    await migrateDatabase(database.db, financeHistory);

    await database.pool.query(
      `INSERT INTO users (id, email, password_hash, display_name)
       VALUES ('10000000-0000-4000-8000-000000000099', 'parallel-0055@example.com', 'unused', 'Parallel 0055')`,
    );
    await database.pool.query(
      `INSERT INTO reminders (user_id, title, kind, status, completed_at, updated_at)
       VALUES
         ('10000000-0000-4000-8000-000000000099', 'Legacy open Task', 'task', 'inbox', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z'),
         ('10000000-0000-4000-8000-000000000099', 'Legacy completed Task', 'task', 'completed', NULL, '2026-01-03T00:00:00Z'),
         ('10000000-0000-4000-8000-000000000099', 'Legacy cancelled Task', 'task', 'cancelled', '2026-01-04T00:00:00Z', '2026-01-05T00:00:00Z')`,
    );

    await migrateDatabase(database.db, migrationsFolder);

    await expect(
      database.pool.query(
        `SELECT reminder.title, reminder.completed_at, reminder.task_cancelled_at,
                reminder.task_lifecycle, reminder.task_revision, list.kind
         FROM reminders AS reminder
         JOIN task_lists AS list ON list.id = reminder.task_list_id
         WHERE reminder.user_id = '10000000-0000-4000-8000-000000000099'
         ORDER BY reminder.title`,
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          completed_at: null,
          kind: "inbox",
          task_cancelled_at: new Date("2026-01-05T00:00:00Z"),
          task_lifecycle: "cancelled",
          task_revision: 1,
          title: "Legacy cancelled Task",
        },
        {
          completed_at: new Date("2026-01-03T00:00:00Z"),
          kind: "inbox",
          task_cancelled_at: null,
          task_lifecycle: "completed",
          task_revision: 1,
          title: "Legacy completed Task",
        },
        {
          completed_at: null,
          kind: "inbox",
          task_cancelled_at: null,
          task_lifecycle: "open",
          task_revision: 1,
          title: "Legacy open Task",
        },
      ],
    });
  });

  it("reconciles Finance after the parallel Task migrations were already applied", async () => {
    const database = await createIsolatedDatabase("finance_after_task_parallel_history");
    const taskHistory = await migrationsWithout(
      migrationsFolder,
      "ilo-finance-after-task-parallel-history-",
      [
        "0055_finance_sync_health",
        "0059_finance_automation_settings",
        "0060_finance_agent_action_reviews",
        "0061_finance_transaction_allocations",
        "0062_finance_reimbursements",
        "0063_finance_maintenance_candidates",
        "0064_finance_ledger_challenges",
        "0065_finance_period_reviews",
        "0066_finance_plan_versions",
        "0067_finance_ledger_protocol",
        "0068_finance_mutation_leases",
        "0069_finance_legacy_budget_backfill",
        "0070_calendar_stewardship_foundations",
        "0071_calendar_event_links",
        "0072_finance_parallel_migration_reconciliation",
        finalReconciliationMigration,
        ...migrationsAfterTaskOrganization,
      ],
    );
    temporaryMigrationFolders.push(taskHistory);
    await migrateDatabase(database.db, taskHistory);

    await migrateDatabase(database.db, migrationsFolder);

    await expect(
      database.pool.query(
        `SELECT sync_state, sync_failure_count
         FROM finance_accounts
         LIMIT 0`,
      ),
    ).resolves.toBeDefined();
    await expect(
      database.pool.query(
        `SELECT review_bypass_enabled
         FROM finance_automation_settings
         LIMIT 0`,
      ),
    ).resolves.toBeDefined();
  });

  it("rejects a Task whose canonical lifecycle is null", async () => {
    await requireTaskOrganizationMigration();
    const database = await createIsolatedDatabase("task_organization_null_lifecycle");
    await migrateDatabase(database.db, migrationsFolder);

    const insertedUser = await database.pool.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, display_name)
       VALUES ('null-lifecycle-task-user@example.com', 'unused', 'Null Lifecycle Task User')
       RETURNING id`,
    );
    const userId = insertedUser.rows[0]?.id;
    if (!userId) throw new Error("Null-lifecycle migration user was not inserted.");
    const inbox = await database.pool.query<{ id: string }>(
      `SELECT id FROM task_lists WHERE user_id = $1 AND kind = 'inbox'`,
      [userId],
    );
    const inboxId = inbox.rows[0]?.id;
    if (!inboxId) throw new Error("Null-lifecycle migration user did not receive an Inbox.");

    await expect(
      database.pool.query(
        `INSERT INTO reminders (
           user_id, title, kind, task_list_id, task_revision
         ) VALUES ($1, 'Null lifecycle Task', 'task', $2, 1)`,
        [userId, inboxId],
      ),
    ).rejects.toThrow();
  });

  it("upgrades every legacy Task in place while normalizing lifecycle timestamps", async () => {
    await requireTaskOrganizationMigration();
    const database = await createIsolatedDatabase("task_organization_upgrade");
    const priorMigrations = await migrationsBeforeTaskOrganization(
      "ilo-task-organization-upgrade-",
    );
    await migrateDatabase(database.db, priorMigrations);

    await database.pool.query(
      `INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at)
       VALUES
         ('10000000-0000-4000-8000-000000000001', 'legacy-one@example.com', 'unused', 'Legacy One', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z'),
         ('10000000-0000-4000-8000-000000000002', 'legacy-two@example.com', 'unused', 'Legacy Two', '2026-02-01T00:00:00Z', '2026-02-02T00:00:00Z')`,
    );
    await database.pool.query(
      `INSERT INTO reminders (
         id, user_id, title, notes, due_at, timezone, priority, kind, status,
         scheduled_at, estimate_minutes, tags, completed_at, deleted_at, created_at, updated_at
       ) VALUES
         ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Inbox Task', 'inbox notes', NULL, NULL, 'medium', 'task', 'inbox', NULL, 10, '["inbox"]', NULL, NULL, '2026-03-01T01:00:00Z', '2026-03-02T01:00:00Z'),
         ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Next Task', NULL, '2026-04-01T12:00:00Z', 'America/New_York', 'high', 'task', 'next', NULL, 20, '["next","work"]', '2026-03-04T02:00:00Z', NULL, '2026-03-01T02:00:00Z', '2026-03-02T02:00:00Z'),
         ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'Scheduled Task', 'scheduled notes', '2026-04-02T12:00:00Z', 'UTC', 'low', 'task', 'scheduled', '2026-04-01T12:00:00Z', 30, '["scheduled"]', NULL, NULL, '2026-03-01T03:00:00Z', '2026-03-02T03:00:00Z'),
         ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'Completed Task', 'done notes', '2026-04-03T12:00:00Z', 'UTC', 'medium', 'task', 'completed', NULL, 40, '["done"]', NULL, NULL, '2026-03-01T04:00:00Z', '2026-03-05T04:00:00Z'),
         ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 'Cancelled Task', 'cancelled notes', NULL, 'UTC', 'medium', 'task', 'cancelled', NULL, NULL, '[]', '2026-03-05T05:00:00Z', NULL, '2026-03-01T05:00:00Z', '2026-03-06T05:00:00Z'),
         ('20000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', 'Trashed Task', 'trash notes', NULL, NULL, 'high', 'task', 'next', NULL, 5, '["trash"]', NULL, '2026-03-07T06:00:00Z', '2026-03-01T06:00:00Z', '2026-03-07T06:00:00Z'),
         ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Ordinary Reminder', 'reminder notes', '2026-04-04T12:00:00Z', 'UTC', 'low', 'reminder', 'next', NULL, NULL, '["reminder"]', '2026-03-08T07:00:00Z', NULL, '2026-03-01T07:00:00Z', '2026-03-08T07:00:00Z')`,
    );

    const materialColumns = `
      id, user_id, title, notes, due_at, timezone, priority, kind, status,
      scheduled_at, estimate_minutes, tags, deleted_at, created_at, updated_at
    `;
    const before = await database.pool.query(
      `SELECT ${materialColumns} FROM reminders ORDER BY id`,
    );

    await migrateDatabase(database.db, migrationsFolder);

    const after = await database.pool.query(`SELECT ${materialColumns} FROM reminders ORDER BY id`);
    expect(after.rows).toEqual(before.rows);

    const migratedTasks = await database.pool.query<{
      completed_at: Date | null;
      id: string;
      inbox_name: string;
      status: string;
      task_cancelled_at: Date | null;
      task_lifecycle: string;
      task_project_id: string | null;
      task_revision: number;
    }>(
      `SELECT reminder.id, reminder.status, reminder.completed_at, reminder.task_lifecycle,
              reminder.task_revision, reminder.task_project_id, reminder.task_cancelled_at,
              list.name AS inbox_name
       FROM reminders AS reminder
       JOIN task_lists AS list
         ON list.id = reminder.task_list_id AND list.user_id = reminder.user_id
       WHERE reminder.kind = 'task'
       ORDER BY reminder.id`,
    );
    expect(migratedTasks.rows).toEqual([
      expect.objectContaining({
        completed_at: null,
        id: "20000000-0000-4000-8000-000000000001",
        inbox_name: "Inbox",
        status: "inbox",
        task_cancelled_at: null,
        task_lifecycle: "open",
        task_project_id: null,
        task_revision: 1,
      }),
      expect.objectContaining({
        completed_at: null,
        id: "20000000-0000-4000-8000-000000000002",
        inbox_name: "Inbox",
        status: "next",
        task_cancelled_at: null,
        task_lifecycle: "open",
        task_project_id: null,
        task_revision: 1,
      }),
      expect.objectContaining({
        completed_at: null,
        id: "20000000-0000-4000-8000-000000000003",
        inbox_name: "Inbox",
        status: "scheduled",
        task_cancelled_at: null,
        task_lifecycle: "open",
        task_project_id: null,
        task_revision: 1,
      }),
      expect.objectContaining({
        completed_at: new Date("2026-03-05T04:00:00Z"),
        id: "20000000-0000-4000-8000-000000000004",
        inbox_name: "Inbox",
        status: "completed",
        task_cancelled_at: null,
        task_lifecycle: "completed",
        task_project_id: null,
        task_revision: 1,
      }),
      expect.objectContaining({
        completed_at: null,
        id: "20000000-0000-4000-8000-000000000005",
        inbox_name: "Inbox",
        status: "cancelled",
        task_cancelled_at: new Date("2026-03-06T05:00:00Z"),
        task_lifecycle: "cancelled",
        task_project_id: null,
        task_revision: 1,
      }),
      expect.objectContaining({
        completed_at: null,
        id: "20000000-0000-4000-8000-000000000006",
        inbox_name: "Inbox",
        status: "next",
        task_cancelled_at: null,
        task_lifecycle: "open",
        task_project_id: null,
        task_revision: 1,
      }),
    ]);

    const reminderFields = await database.pool.query(
      `SELECT completed_at, task_list_id, task_project_id, task_why, task_lifecycle, task_revision,
              task_cancelled_at, task_create_idempotency_key,
              task_create_idempotency_fingerprint
       FROM reminders
       WHERE id = '30000000-0000-4000-8000-000000000001'`,
    );
    expect(reminderFields.rows).toEqual([
      {
        completed_at: new Date("2026-03-08T07:00:00Z"),
        task_cancelled_at: null,
        task_create_idempotency_fingerprint: null,
        task_create_idempotency_key: null,
        task_lifecycle: null,
        task_list_id: null,
        task_project_id: null,
        task_revision: null,
        task_why: null,
      },
    ]);
    const inboxCounts = await database.pool.query<{ count: string; user_id: string }>(
      `SELECT user_id, count(*)
       FROM task_lists
       WHERE kind = 'inbox'
       GROUP BY user_id
       ORDER BY user_id`,
    );
    expect(inboxCounts.rows).toEqual([
      { count: "1", user_id: "10000000-0000-4000-8000-000000000001" },
      { count: "1", user_id: "10000000-0000-4000-8000-000000000002" },
    ]);
  });

  it("fails closed before an unexpectedly large deploy-time Task backfill", async () => {
    await requireTaskOrganizationMigration();
    const database = await createIsolatedDatabase("task_organization_oversized");
    const priorMigrations = await migrationsBeforeTaskOrganization(
      "ilo-task-organization-oversized-",
    );
    await migrateDatabase(database.db, priorMigrations);
    const insertedUser = await database.pool.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, display_name)
       VALUES ('oversized-task-user@example.com', 'unused', 'Oversized Task User')
       RETURNING id`,
    );
    const userId = insertedUser.rows[0]?.id;
    if (!userId) throw new Error("Oversized migration user was not inserted.");
    await database.pool.query(
      `INSERT INTO reminders (user_id, title, kind)
       SELECT $1, 'Legacy Task ' || value, 'task'
       FROM generate_series(1, 50001) AS value`,
      [userId],
    );

    let migrationFailure: unknown;
    try {
      await migrateDatabase(database.db, migrationsFolder);
    } catch (error) {
      migrationFailure = error;
    }
    expect(migrationFailure).toBeDefined();
    expect((migrationFailure as { cause?: Error }).cause?.message).toMatch(
      /50001 Task rows.*50000/u,
    );
    const organizationTable = await database.pool.query<{ name: string | null }>(
      `SELECT to_regclass('public.task_lists')::text AS name`,
    );
    expect(organizationTable.rows[0]?.name).toBeNull();
  });
});
