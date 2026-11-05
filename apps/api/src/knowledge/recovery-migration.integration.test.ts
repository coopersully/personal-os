import { createHash, randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDatabaseClient, type DatabaseClient, migrateDatabase } from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";

const folder = resolve(process.cwd(), "packages/database/migrations");
const original = "0130_persistent_knowledge";
const finance = "0130_finance_provider_account_identity";
const branding = "0131_finance_institution_branding";
const recovery = "0132_persistent_knowledge_recovery";
const tables = [
  "knowledge_records",
  "knowledge_revisions",
  "knowledge_sources",
  "knowledge_relationships",
  "knowledge_receipts",
];

describe.sequential("append-only Knowledge migration recovery", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
  }, 120_000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });
  beforeEach(async () => {
    await database.pool.query(
      "DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE",
    );
  });

  // Exercise real published histories through Drizzle, never manufacture ledger rows.
  async function history(excluded: string[]) {
    const path = await mkdtemp(join(tmpdir(), "nohmi-knowledge-history-"));
    try {
      await cp(folder, path, { recursive: true });
      const journal = JSON.parse(await readFile(join(path, "meta/_journal.json"), "utf8")) as {
        entries: Array<{ tag: string }>;
      };
      journal.entries = journal.entries.filter((entry) => !excluded.includes(entry.tag));
      await writeFile(join(path, "meta/_journal.json"), JSON.stringify(journal));
      await migrateDatabase(database.db, path);
    } finally {
      await rm(path, { recursive: true, force: true });
    }
  }
  async function ledger() {
    return (
      await database.pool.query<{ hash: string; created_at: string }>(
        "SELECT hash, created_at::text FROM drizzle.__drizzle_migrations ORDER BY id",
      )
    ).rows;
  }
  async function tableCount() {
    return Number(
      (
        await database.pool.query<{ count: string }>(
          "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND c.relkind='r'",
          [tables],
        )
      ).rows[0]?.count,
    );
  }
  async function user() {
    const id = randomUUID();
    await database.pool.query(
      "INSERT INTO public.users(id,email,display_name,password_hash) VALUES($1,$2,'Recovery','unused')",
      [id, `${id}@example.test`],
    );
    return id;
  }
  async function snapshot() {
    return (
      await database.pool.query<{ table_name: string; value: unknown }>(
        `SELECT * FROM (SELECT 'records' AS table_name, to_jsonb(r) AS value FROM knowledge_records r
       UNION ALL SELECT 'revisions', to_jsonb(r) FROM knowledge_revisions r
       UNION ALL SELECT 'sources', to_jsonb(r) FROM knowledge_sources r
       UNION ALL SELECT 'relationships', to_jsonb(r) FROM knowledge_relationships r
       UNION ALL SELECT 'receipts', to_jsonb(r) FROM knowledge_receipts r) snapshots
       ORDER BY table_name, value::text`,
      )
    ).rows;
  }

  async function catalog() {
    return (
      await database.pool.query(
        `SELECT c.relname, a.attnum, a.attname, format_type(a.atttypid,a.atttypmod) AS type,
          a.attnotnull, pg_get_expr(d.adbin,d.adrelid) AS default_value
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
         LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
         WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname,a.attnum`,
        [tables],
      )
    ).rows;
  }

  it("creates the same catalog on a fresh chain and restores the caller search path", async () => {
    await migrateDatabase(database.db, folder);
    const fresh = await catalog();
    expect(await tableCount()).toBe(5);
    const client = await database.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL search_path=public,pg_catalog");
      const before = (await client.query("SHOW search_path")).rows;
      await client.query(await readFile(join(folder, `${recovery}.sql`), "utf8"));
      expect((await client.query("SHOW search_path")).rows).toEqual(before);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    await database.pool.query(
      "DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA drizzle CASCADE",
    );
    await history([original, recovery]);
    await migrateDatabase(database.db, folder);
    expect(await catalog()).toEqual(fresh);
  }, 120_000);

  it("recovers after the published branding watermark without inventing the skipped original receipt", async () => {
    await history([original, recovery]);
    const owner = await user();
    const itemId = randomUUID();
    await database.pool.query(
      "INSERT INTO finance_provider_items(id,user_id,provider,provider_item_id,encrypted_credentials,institution_id,institution_branding) VALUES($1,$2,'plaid','fixture-item','{}','fixture-bank',$3)",
      [itemId, owner, { name: "Preserved bank" }],
    );
    const itemBefore = (
      await database.pool.query(
        "SELECT to_jsonb(i) AS value FROM finance_provider_items i WHERE id=$1",
        [itemId],
      )
    ).rows;
    const before = await ledger();
    expect(await tableCount()).toBe(0);
    await migrateDatabase(database.db, folder);
    expect(await tableCount()).toBe(5);
    expect(
      (
        await database.pool.query(
          "SELECT to_jsonb(i) AS value FROM finance_provider_items i WHERE id=$1",
          [itemId],
        )
      ).rows,
    ).toEqual(itemBefore);
    const hash = async (tag: string) =>
      createHash("sha256")
        .update(await readFile(join(folder, `${tag}.sql`)))
        .digest("hex");
    const after = await ledger();
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.map((row) => row.hash)).not.toContain(await hash(original));
    expect(after.at(-1)).toEqual({ hash: await hash(recovery), created_at: "1793300055682" });
    await migrateDatabase(database.db, folder);
    expect(await ledger()).toEqual(after);
  }, 120_000);

  it("applies branding and recovery after the Finance watermark without changing the earlier receipt", async () => {
    await history([original, branding, recovery]);
    const before = await ledger();
    await migrateDatabase(database.db, folder);
    expect(await tableCount()).toBe(5);
    expect((await ledger()).slice(0, before.length)).toEqual(before);
    expect((await ledger()).slice(before.length).map((row) => row.created_at)).toEqual([
      "1793300055681",
      "1793300055682",
    ]);
  }, 120_000);

  it("applies the fresh composed history and preserves existing Knowledge rows on compatible recovery", async () => {
    await history([finance, branding, recovery]);
    const owner = await user();
    const other = await user();
    const id = randomUUID();
    const related = randomUUID();
    await database.pool.query("INSERT INTO knowledge_records(id,user_id) VALUES($1,$2),($3,$2)", [
      id,
      owner,
      related,
    ]);
    await database.pool.query(
      "INSERT INTO knowledge_revisions(user_id,record_id,revision,snapshot) VALUES($1,$2,1,$3)",
      [owner, id, { content: "Original wording" }],
    );
    await database.pool.query(
      "INSERT INTO knowledge_sources(id,user_id,record_id,source) VALUES($1,$2,$3,$4)",
      [randomUUID(), owner, id, { evidence: "Original evidence" }],
    );
    await database.pool.query(
      "INSERT INTO knowledge_relationships(user_id,record_id,related_record_id) VALUES($1,$2,$3)",
      [owner, id, related],
    );
    await database.pool.query(
      "INSERT INTO knowledge_receipts(user_id,record_id,mutation_key,request_hash) VALUES($1,$2,$3,'unchanged')",
      [owner, id, randomUUID()],
    );
    const before = await snapshot();
    await migrateDatabase(database.db, folder);
    expect(await snapshot()).toEqual(before);
    await expect(
      database.pool.query(
        "INSERT INTO knowledge_sources(id,user_id,record_id,source) VALUES($1,$2,$3,'{}')",
        [randomUUID(), other, id],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      database.pool.query("INSERT INTO knowledge_records(id,user_id) VALUES($1,$2)", [id, owner]),
    ).rejects.toMatchObject({ code: "23505" });
    const after = await ledger();
    await migrateDatabase(database.db, folder);
    expect(await ledger()).toEqual(after);
  }, 120_000);

  it("rolls back pending branding and recovery together on partial Knowledge state", async () => {
    await history([original, branding, recovery]);
    await database.pool.query(
      "CREATE TABLE knowledge_records(sentinel text); INSERT INTO knowledge_records VALUES('preserve')",
    );
    const before = await ledger();
    await expect(migrateDatabase(database.db, folder)).rejects.toThrow();
    expect(await ledger()).toEqual(before);
    expect(await tableCount()).toBe(1);
    expect((await database.pool.query("SELECT sentinel FROM knowledge_records")).rows).toEqual([
      { sentinel: "preserve" },
    ]);
    expect(
      (
        await database.pool.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='finance_provider_items' AND column_name='institution_branding'",
        )
      ).rows,
    ).toHaveLength(0);
  }, 120_000);

  it.each([
    "ALTER TABLE knowledge_revisions ALTER COLUMN snapshot TYPE text USING snapshot::text",
    "ALTER TABLE knowledge_records ALTER COLUMN revision SET DEFAULT 2",
    "ALTER TABLE knowledge_sources ALTER COLUMN source DROP NOT NULL",
    "ALTER TABLE knowledge_revisions DROP CONSTRAINT knowledge_revisions_owner_record_revision_idx",
    "ALTER TABLE knowledge_sources DROP CONSTRAINT knowledge_sources_user_id_record_id_fkey; ALTER TABLE knowledge_sources ADD FOREIGN KEY(record_id) REFERENCES knowledge_records(id)",
    "ALTER TABLE knowledge_sources DROP CONSTRAINT knowledge_sources_user_id_record_id_fkey; ALTER TABLE knowledge_sources ADD FOREIGN KEY(user_id,record_id) REFERENCES knowledge_records(user_id,id) ON DELETE CASCADE NOT VALID",
    "ALTER TABLE knowledge_records ENABLE ROW LEVEL SECURITY",
    "ALTER TABLE knowledge_records ADD CHECK(revision<10)",
  ])("rejects incompatible complete catalog without repairing or advancing its receipt: %s", async (change) => {
    await history([recovery]);
    await database.pool.query(change);
    const before = await ledger();
    await expect(migrateDatabase(database.db, folder)).rejects.toThrow();
    expect(await ledger()).toEqual(before);
    expect(await tableCount()).toBe(5);
  }, 120_000);

  it("fails closed when the lower published dependency receipt is missing", async () => {
    await history([original, finance, recovery]);
    const before = await ledger();
    await expect(migrateDatabase(database.db, folder)).rejects.toThrow();
    expect(await ledger()).toEqual(before);
    expect(await tableCount()).toBe(0);
  }, 120_000);
});
