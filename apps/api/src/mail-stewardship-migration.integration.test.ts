import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createDatabaseClient, type DatabaseClient, migrateDatabase } from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { migrationsWithout } from "./test-migrations.js";

describe.sequential("Mail stewardship migration reconciliation", { timeout: 15_000 }, () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let migrationsThroughDesktopMail: string | undefined;
  const migrationsFolder = resolve(process.cwd(), "packages/database/migrations");

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine")
      .withDatabase("personal_os")
      .withUsername("personal_os")
      .withPassword("personal_os")
      .start();
    database = createDatabaseClient(container.getConnectionUri());
    migrationsThroughDesktopMail = await migrationsWithout(
      migrationsFolder,
      "nohmi-mail-stewardship-reconciliation-",
      [
        "0073_mail_workspace_stewardship",
        "0078_mail_workspace_stewardship_reconciliation",
        "0079_mail_stewardship_integrity",
      ],
    );
    await migrateDatabase(database.db, migrationsThroughDesktopMail);
  }, 120_000);

  afterAll(async () => {
    await database?.close();
    await container?.stop();
    if (migrationsThroughDesktopMail) {
      await rm(migrationsThroughDesktopMail, { force: true, recursive: true });
    }
  });

  it("creates Mail stewardship tables when an idx 81 database skipped migration 0073", async () => {
    await migrateDatabase(database.db, migrationsFolder);

    const tables = await database.pool.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN (
           'mail_obligations',
           'mail_thread_dispositions',
           'mail_stewardship_questions',
           'mail_rule_proposals',
           'mail_stewardship_feedback',
           'mail_reviews'
         )
       ORDER BY table_name`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "mail_obligations",
      "mail_reviews",
      "mail_rule_proposals",
      "mail_stewardship_feedback",
      "mail_stewardship_questions",
      "mail_thread_dispositions",
    ]);

    const questionConstraint = await database.pool.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conname = 'mail_stewardship_questions_answer_check'`,
    );
    expect(questionConstraint.rows[0]?.definition).toContain("btrim(answer)");
    expect(questionConstraint.rows[0]?.definition).toContain("answered_at IS NOT NULL");
    expect(questionConstraint.rows[0]?.definition).toContain("answered_at IS NULL");

    const reviewColumns = await database.pool.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'mail_reviews'
         AND column_name IN ('run_id', 'scope')
       ORDER BY column_name`,
    );
    expect(reviewColumns.rows.map((row) => row.column_name)).toEqual(["run_id", "scope"]);
  });
});
