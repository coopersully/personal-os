import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createDatabaseClient,
  financeAccounts,
  financeReviewArchives,
  financeTransactions,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { createInboxService } from "./inbox-service.js";

it("upgrades a database that already applied the first published 0105 archive", async () => {
  const migrations = resolve(process.cwd(), "packages/database/migrations");
  const journal = JSON.parse(await readFile(join(migrations, "meta/_journal.json"), "utf8")) as {
    entries: Array<{ tag: string }>;
  };
  const cutoff = journal.entries.findIndex(
    (entry) => entry.tag === "0105_finance_review_history_archive",
  );
  expect(cutoff).toBeGreaterThan(0);
  const original0105 = await readFile(
    join(migrations, "0105_finance_review_history_archive.sql"),
    "utf8",
  );
  expect(original0105).toContain("LANGUAGE sql");
  expect(original0105).toContain("'transactionDate'");
  const oldMigrations = await mkdtemp(join(tmpdir(), "nohmi-review-archive-upgrade-"));
  const container = await new PostgreSqlContainer("postgres:17.5-alpine")
    .withDatabase("personal_os")
    .withUsername("personal_os")
    .withPassword("personal_os")
    .start();
  const database = createDatabaseClient(container.getConnectionUri());
  try {
    await mkdir(join(oldMigrations, "meta"));
    const oldEntries = journal.entries.slice(0, cutoff + 1);
    await Promise.all(
      oldEntries.map((entry) =>
        copyFile(join(migrations, `${entry.tag}.sql`), join(oldMigrations, `${entry.tag}.sql`)),
      ),
    );
    await writeFile(
      join(oldMigrations, "meta/_journal.json"),
      JSON.stringify({ ...journal, entries: oldEntries }),
    );
    await migrateDatabase(database.db, oldMigrations);

    const [owner] = await database.db
      .insert(users)
      .values({
        displayName: "Archive upgrade",
        email: `archive-upgrade-${randomUUID()}@example.com`,
        passwordHash: "unused",
      })
      .returning();
    if (!owner) throw new Error("Archive upgrade owner was not created.");
    const [account] = await database.db
      .insert(financeAccounts)
      .values({ institution: "Test bank", name: "Checking", provider: "manual", userId: owner.id })
      .returning();
    if (!account) throw new Error("Archive upgrade account was not created.");
    const transactions = await database.db
      .insert(financeTransactions)
      .values(
        ["Before upgrade", "After upgrade"].map((merchant) => ({
          accountId: account.id,
          amount: 1200,
          direction: "expense" as const,
          merchant,
          transactionDate: "2026-10-08",
          userId: owner.id,
        })),
      )
      .returning();
    if (!transactions[0] || !transactions[1]) throw new Error("Transactions were not created.");
    // The fixture is deliberately still on original 0105. Use only its columns;
    // the current ORM schema also contains fields introduced by later migrations.
    const cases: { id: string }[] = [];
    for (const transaction of transactions) {
      const inserted = await database.pool.query<{ id: string }>(
        "INSERT INTO finance_review_cases (user_id,transaction_id,stable_key,status,reason_code,evidence,impact_amount_cents) VALUES ($1,$2,$3,'resolved','unusual_amount',$4,1200) RETURNING id",
        [
          owner.id,
          transaction.id,
          `archive-upgrade:${transaction.id}`,
          JSON.stringify({ source: "upgrade regression" }),
        ],
      );
      cases.push(...inserted.rows);
    }
    const [legacyCase, upgradedCase] = cases;
    if (!legacyCase || !upgradedCase) throw new Error("Review cases were not created.");

    await database.db
      .delete(financeTransactions)
      .where(eq(financeTransactions.id, transactions[0].id));
    const [legacy] = await database.db
      .select()
      .from(financeReviewArchives)
      .where(eq(financeReviewArchives.id, legacyCase.id));
    expect(legacy?.context).toMatchObject({ transactionDate: "2026-10-08" });
    expect(legacy?.context).not.toHaveProperty("date");
    expect(legacy?.context).not.toHaveProperty("institution");

    await migrateDatabase(database.db, migrations);
    const service = createInboxService({ db: database.db, now: () => new Date() });
    expect(await service.getFinanceReviewHistoryItem(owner.id, legacyCase.id)).toMatchObject({
      archived: true,
      context: { date: "2026-10-08", institution: "" },
      evidence: { source: "upgrade regression" },
    });
    expect(
      (await service.listFinanceReviewHistory(owner.id, { limit: 2 })).items.find(
        (item) => item.id === legacyCase.id,
      ),
    ).toMatchObject({ context: { date: "2026-10-08", institution: "" } });
    const [unchanged] = await database.db
      .select()
      .from(financeReviewArchives)
      .where(eq(financeReviewArchives.id, legacyCase.id));
    expect(unchanged?.context).toEqual(legacy?.context);

    await database.db
      .delete(financeTransactions)
      .where(eq(financeTransactions.id, transactions[1].id));
    const [upgraded] = await database.db
      .select()
      .from(financeReviewArchives)
      .where(eq(financeReviewArchives.id, upgradedCase.id));
    expect(upgraded?.context).toMatchObject({
      date: "2026-10-08",
      institution: "Test bank",
    });
    expect(upgraded?.context).not.toHaveProperty("transactionDate");
    const functionDefinition = await database.pool.query<{ definition: string }>(
      "SELECT pg_get_functiondef('finance_archive_transaction_reviews(uuid,uuid)'::regprocedure) AS definition",
    );
    expect(functionDefinition.rows[0]?.definition).toContain("FOR UPDATE");
  } finally {
    await database.close();
    await container.stop();
    await rm(oldMigrations, { recursive: true, force: true });
  }
}, 120_000);
