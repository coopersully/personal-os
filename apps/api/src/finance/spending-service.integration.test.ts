import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  financeAccounts,
  financeCategories,
  financeTransactions,
  migrateDatabase,
  users,
} from "@personal-os/database";
import type { FinanceSpendingQuery } from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createFinanceSpendingService,
  selectFinanceSpendingReferences,
} from "./spending-service.js";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing Spending fixture");
  return value;
}

// Deferred to the reserved PostgreSQL runner; never replace this boundary with a mock.
describe.sequential("Spending owner-scoped complete storage snapshot", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let owner: string,
    foreign: string,
    accountId: string,
    foreignAccountId: string,
    categoryId: string,
    foreignCategoryId: string;
  const query: FinanceSpendingQuery = {
    scope: {
      from: "2026-03-07",
      through: "2026-03-09",
      timezone: "America/New_York",
      accountIds: null,
      categoryIds: null,
      basis: "personal_cost",
      includePending: true,
      subtractRefunds: true,
    },
    grouping: "auto",
    includeUncategorized: true,
  };
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
    const owners = await database.db
      .insert(users)
      .values([
        { displayName: "Spending", email: "spending-boundary@example.com", passwordHash: "unused" },
        { displayName: "Foreign", email: "spending-foreign@example.com", passwordHash: "unused" },
      ])
      .returning();
    owner = required(owners[0]).id;
    foreign = required(owners[1]).id;
    const accounts = await database.db
      .insert(financeAccounts)
      .values(
        [owner, foreign].map((userId) => ({
          userId,
          provider: "manual" as const,
          name: "Cash",
          institution: "Synthetic",
          balance: 10000,
          currencyCode: "USD",
          ownershipType: "individual" as const,
          ownershipShareBps: 10000,
        })),
      )
      .returning();
    accountId = required(accounts[0]).id;
    foreignAccountId = required(accounts[1]).id;
    const categories = await database.db
      .insert(financeCategories)
      .values(
        [owner, foreign].map((userId) => ({
          userId,
          name: "Food",
          slug: "food",
          group: "essentials",
        })),
      )
      .returning();
    categoryId = required(categories[0]).id;
    foreignCategoryId = required(categories[1]).id;
    await database.db.insert(financeTransactions).values([
      {
        userId: owner,
        accountId,
        categoryId,
        merchant: "Pending",
        amount: 900,
        direction: "expense",
        transactionDate: "2026-03-08",
        pending: true,
        providerTransactionId: "pending",
      },
      // Replacement is outside requested date; complete identity resolution must still suppress it.
      {
        userId: owner,
        accountId,
        categoryId,
        merchant: "Posted",
        amount: 900,
        direction: "expense",
        transactionDate: "2026-03-10",
        providerTransactionId: "posted",
        pendingTransactionId: "pending",
      },
      {
        userId: owner,
        accountId,
        categoryId,
        merchant: "Removed pending",
        amount: 300,
        direction: "expense",
        transactionDate: "2026-03-08",
        pending: true,
        providerTransactionId: "removed",
        pendingTransactionId: "removed",
      },
      {
        userId: foreign,
        accountId: foreignAccountId,
        categoryId: foreignCategoryId,
        merchant: "Foreign",
        amount: 9999,
        direction: "expense",
        transactionDate: "2026-03-08",
      },
      ...Array.from({ length: 110 }, (_, i) => ({
        userId: owner,
        accountId,
        categoryId,
        merchant: `Owned ${i}`,
        amount: 1,
        direction: "expense" as const,
        transactionDate: "2026-03-08",
      })),
    ]);
  }, 120000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });
  it("loads beyond a transaction page, suppresses removed/replaced identities and retains unknown history", async () => {
    const result = await createFinanceSpendingService({
      db: database.db,
      now: () => new Date("2026-03-11T12:00:00Z"),
    }).readSpending(owner, query);
    expect(result.snapshot.netCents).toBe(110);
    expect(result.transactions).toHaveLength(110);
    expect(result.snapshot.coverage).toBe("unknown");
    expect(result.accounts.map((row) => row.id)).toEqual([accountId]);
    expect(result.categories.map((row) => row.id)).toEqual([categoryId]);
  });
  it("rejects foreign requests, preserves explicit empty selection", async () => {
    const service = createFinanceSpendingService({
      db: database.db,
      now: () => new Date("2026-03-11T12:00:00Z"),
    });
    await expect(
      service.readSpending(owner, {
        ...query,
        scope: { ...query.scope, accountIds: [foreignAccountId] },
      }),
    ).rejects.toThrow("selection was not found");
    await expect(
      service.readSpending(owner, {
        ...query,
        scope: { ...query.scope, categoryIds: [foreignCategoryId] },
      }),
    ).rejects.toThrow("selection was not found");
    expect(
      (await service.readSpending(owner, { ...query, scope: { ...query.scope, accountIds: [] } }))
        .snapshot.netCents,
    ).toBe(0);
  });
  it("binds exact reference pages to the current persisted snapshot", async () => {
    const service = createFinanceSpendingService({
      db: database.db,
      now: () => new Date("2026-03-11T12:00:00Z"),
    });
    const dashboard = await service.readSpending(owner, query);
    const filter = {
      query,
      referenceRevision: dashboard.referenceRevision ?? "",
      groupId: null,
      from: query.scope.from,
      through: query.scope.through,
    };
    const page = selectFinanceSpendingReferences(dashboard, filter, undefined, 50);
    expect(page.totalTransactions).toBe(110);
    expect(page.transactionIds).toHaveLength(50);
    expect(page.netCents).toBe(110);
    expect(page.contributions).toHaveLength(50);
    const first = required(dashboard.transactions[0]);
    await database.db
      .update(financeTransactions)
      .set({ amount: 2, updatedAt: new Date("2026-03-11T12:01:00Z") })
      .where(and(eq(financeTransactions.userId, owner), eq(financeTransactions.id, first.id)));
    const changed = await service.readSpending(owner, query);
    expect(() => selectFinanceSpendingReferences(changed, filter)).toThrow("Spending changed");
  });
});
