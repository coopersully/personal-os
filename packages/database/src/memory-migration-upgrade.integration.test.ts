import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "drizzle-orm";
import { createDatabaseClient, type DatabaseClient, migrateDatabase, users } from "./index.js";

const realFolder = resolve(process.cwd(), "packages/database/migrations");

type Journal = { entries: { tag: string }[] };

async function memorySchema(database: DatabaseClient) {
  const column = await database.db.execute<{ data_type: string; is_nullable: string; d: string }>(
    sql`SELECT data_type, is_nullable, column_default AS d FROM information_schema.columns
        WHERE table_name = 'knowledge_records' AND column_name = 'trash_version'`,
  );
  const checks = await database.db.execute<{ conname: string; def: string }>(
    sql`SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname = 'knowledge_records_trash_version'`,
  );
  const indexes = await database.db.execute<{ indexname: string; indexdef: string }>(
    sql`SELECT indexname, indexdef FROM pg_indexes
        WHERE indexname IN ('knowledge_sources_owner_record_idx', 'knowledge_relationships_owner_related_idx')
        ORDER BY indexname`,
  );
  return { column: column.rows, checks: checks.rows, indexes: indexes.rows };
}

describe.sequential("memory schema upgrade across migration 0147", () => {
  let container: StartedPostgreSqlContainer;
  let scratch: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine")
      .withUsername("personal_os")
      .withPassword("personal_os")
      .withDatabase("personal_os")
      .start();
    scratch = await mkdtemp(join(tmpdir(), "memory-upgrade-"));
  }, 120_000);

  afterAll(async () => {
    await rm(scratch, { recursive: true, force: true });
    await container.stop();
  });

  async function createDatabase(name: string) {
    const admin = createDatabaseClient(container.getConnectionUri());
    await admin.db.execute(sql.raw(`CREATE DATABASE ${name}`));
    await admin.close();
    return createDatabaseClient(container.getConnectionUri().replace(/\/personal_os$/, `/${name}`));
  }

  it("adds trash_version, its CHECK and both indexes to a database already at 0146", async () => {
    const truncated = join(scratch, "through-0146");
    await cp(realFolder, truncated, { recursive: true });
    const journalPath = join(truncated, "meta/_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as Journal;
    const last = journal.entries.findIndex((entry) => entry.tag === "0146_persistent_memory");
    expect(last).toBeGreaterThan(-1);
    journal.entries = journal.entries.slice(0, last + 1);
    await writeFile(journalPath, JSON.stringify(journal, null, 2));

    const database = await createDatabase("memory_upgrade");
    try {
      await migrateDatabase(database.db, truncated);
      expect((await memorySchema(database)).column).toEqual([]);

      const [user] = await database.db
        .insert(users)
        .values({ displayName: "Upgrade", email: "upgrade@example.com", passwordHash: "unused" })
        .returning();
      if (!user) throw new Error("Fixture user was not created.");
      await database.db.execute(sql`INSERT INTO knowledge_records (user_id) VALUES (${user.id})`);

      await migrateDatabase(database.db, realFolder);

      const rows = await database.db.execute<{ trash_version: number }>(
        sql`SELECT trash_version FROM knowledge_records WHERE user_id = ${user.id}`,
      );
      expect(rows.rows).toEqual([{ trash_version: 0 }]);
      const schema = await memorySchema(database);
      expect(schema.checks.map((row) => row.def)).toEqual(["CHECK ((trash_version >= 0))"]);
      expect(schema.indexes.map((row) => row.indexname)).toEqual([
        "knowledge_relationships_owner_related_idx",
        "knowledge_sources_owner_record_idx",
      ]);
      await expect(
        database.db.execute(
          sql`UPDATE knowledge_records SET trash_version = -1 WHERE user_id = ${user.id}`,
        ),
      ).rejects.toThrow();
    } finally {
      await database.close();
    }
  }, 120_000);

  it("a fresh full migration ends in the same column, constraint and indexes", async () => {
    const upgraded = await createDatabase("memory_upgrade_compare");
    const fresh = await createDatabase("memory_fresh");
    try {
      const truncated = join(scratch, "through-0146");
      await migrateDatabase(upgraded.db, truncated);
      await migrateDatabase(upgraded.db, realFolder);
      await migrateDatabase(fresh.db, realFolder);
      const freshSchema = await memorySchema(fresh);
      expect(freshSchema.column).toEqual([{ data_type: "integer", is_nullable: "NO", d: "0" }]);
      expect(freshSchema.checks).toHaveLength(1);
      expect(freshSchema.indexes).toHaveLength(2);
      expect(await memorySchema(upgraded)).toEqual(freshSchema);
    } finally {
      await upgraded.close();
      await fresh.close();
    }
  }, 120_000);
});
