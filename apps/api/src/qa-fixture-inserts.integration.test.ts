import { resolve } from "node:path";
import { createDatabaseClient, migrateDatabase } from "@personal-os/database";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { expect, it, vi } from "vitest";
import { loadQaFixtures, qaFixtureAccounts } from "./qa-fixtures.js";

// Missing artwork is a valid fixture state: accounts still load without provider projections.
vi.mock("./fixtures/institution-branding.js", () => ({ fixtureInstitutionBranding: {} }));
it("loads empty and unbranded personas without submitting empty Finance inserts", async () => {
  const container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
  const database = createDatabaseClient(container.getConnectionUri());
  try {
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
    const empty = qaFixtureAccounts.filter((account) => account.key === "qa-empty");
    expect(empty).toHaveLength(1);
    await loadQaFixtures(database.db, { accounts: empty });
    expect(await database.db.query.financeAccounts.findMany()).toHaveLength(0);
    expect(await database.db.query.financeProviderItems.findMany()).toHaveLength(0);
    const complete = qaFixtureAccounts.filter((account) => account.key === "qa-loaded");
    expect(complete).toHaveLength(1);
    await loadQaFixtures(database.db, { accounts: complete });
    expect(await database.db.query.financeAccounts.findMany()).toHaveLength(4);
    expect(await database.db.query.financeProviderItems.findMany()).toHaveLength(0);
    const messages = await database.db.query.financeConversationMessages.findMany();
    expect(messages).toHaveLength(6);
    const transaction = await database.db.query.financeTransactions.findFirst({
      where: (row, { eq }) => eq(row.id, messages[0]?.recordRefs[0]?.id ?? ""),
    });
    expect(transaction).toMatchObject({ merchant: "SQ *UNKNOWN POPUP 8821", needsReview: true });
    expect(messages.every((message) => message.recordRefs[0]?.id === transaction?.id)).toBe(true);
  } finally {
    await database.close();
    await container.stop();
  }
}, 120_000);
