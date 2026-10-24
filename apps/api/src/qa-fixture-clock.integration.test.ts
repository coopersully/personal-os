import { resolve } from "node:path";
import {
  createDatabaseClient,
  financeTransactions,
  migrateDatabase,
  sessions,
} from "@personal-os/database";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { createFinanceBudgetBaselineQualificationService } from "./finance/baseline-qualification-service.js";
import { refreshQaFinanceFixtures } from "./qa-fixture-clock.js";
import { loadQaFixtures, qaFixtureAccounts } from "./qa-fixtures.js";

it("catches up through DST/month rollover without duplicates, lost edits, sessions or other persona changes", async () => {
  const container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
  const database = createDatabaseClient(container.getConnectionUri());
  try {
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
    expect(await refreshQaFinanceFixtures(database.db)).toBeNull();
    const seed = new Date("2026-10-31T23:00:00Z");
    await loadQaFixtures(database.db, {
      accounts: qaFixtureAccounts.filter((row) => ["demo-full", "qa-empty"].includes(row.key)),
      now: seed,
    });
    const owner = qaFixtureAccounts[0].id;
    const original = await database.db.query.financeTransactions.findFirst({
      where: (row, { eq }) => eq(row.userId, owner),
    });
    if (!original) throw new Error("Fixture transaction missing");
    await database.db
      .update(financeTransactions)
      .set({ notes: "Keep my demo edit" })
      .where(eq(financeTransactions.id, original.id));
    await database.db.insert(sessions).values({
      userId: owner,
      tokenHash: "fixture-clock-session",
      expiresAt: new Date("2027-01-01T00:00:00Z"),
    });
    const now = new Date("2026-11-02T17:00:00Z");
    expect(await refreshQaFinanceFixtures(database.db, now)).toMatchObject({
      days: 2,
      caughtUp: true,
    });
    const rows = await database.db.query.financeTransactions.findMany({
      where: (row, { like }) => like(row.providerTransactionId, "fixture-live-%"),
    });
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.transactionDate).sort()).toEqual([
      "2026-11-01",
      "2026-11-01",
      "2026-11-02",
    ]);
    expect(await refreshQaFinanceFixtures(database.db, now)).toMatchObject({
      days: 0,
      caughtUp: true,
    });
    expect(
      await database.db.query.financeTransactions.findMany({
        where: (row, { like }) => like(row.providerTransactionId, "fixture-live-%"),
      }),
    ).toHaveLength(3);
    expect(
      (
        await database.db.query.financeTransactions.findFirst({
          where: eq(financeTransactions.id, original.id),
        })
      )?.notes,
    ).toBe("Keep my demo edit");
    expect(await database.db.query.sessions.findMany()).toHaveLength(1);
    const empty = qaFixtureAccounts.find((row) => row.key === "qa-empty");
    expect(
      await database.db.query.financeTransactions.findMany({
        where: eq(financeTransactions.userId, empty?.id ?? ""),
      }),
    ).toHaveLength(0);
    expect(
      await database.db.query.financeTransactionCoverage.findMany({
        where: (row, { eq }) => eq(row.throughDate, "2026-11-01"),
      }),
    ).toHaveLength(4);
    expect(
      (
        await createFinanceBudgetBaselineQualificationService({
          db: database.db,
          now: () => now,
        }).getQualification(owner, "2026-11")
      ).state,
    ).toBe("qualified");
    expect(
      await refreshQaFinanceFixtures(database.db, new Date("2026-11-03T17:00:00Z")),
    ).toMatchObject({ days: 1, caughtUp: true });
    expect(
      await database.db.query.financeTransactionCoverage.findMany({
        where: (row, { eq }) => eq(row.throughDate, "2026-11-02"),
      }),
    ).toHaveLength(4);
  } finally {
    await database.close();
    await container.stop();
  }
}, 120_000);
