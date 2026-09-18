import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  financeAccounts,
  financeEconomicEvents,
  financeTransactionRelationships,
  financeTransactions,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { financePositionEvidenceSchema } from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { createFinancePositionService } from "./position-service.js";

const dates = { from: "2026-09-01", through: "2026-09-18" };
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Position fixture was not created.");
  return value;
}
const timestamp = new Date("2026-09-18T12:00:00.000Z");

describe.sequential("Finance position persistence boundary", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let userId: string;
  let foreignId: string;
  let cashId: string;
  let foreignAccountId: string;
  let expenseId: string;
  let creditId: string;
  let service: ReturnType<typeof createFinancePositionService>;
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
    const owners = await database.db
      .insert(users)
      .values([
        { displayName: "Position", email: "position@example.com", passwordHash: "unused" },
        { displayName: "Other", email: "other-position@example.com", passwordHash: "unused" },
      ])
      .returning();
    userId = required(owners[0]).id;
    foreignId = required(owners[1]).id;
    const accounts = await database.db
      .insert(financeAccounts)
      .values([
        {
          userId,
          provider: "manual",
          institution: "Synthetic",
          name: "Cash",
          balance: 10_000,
          currencyCode: "USD",
          ownershipType: "individual",
          ownershipShareBps: 10_000,
        },
        {
          userId: foreignId,
          provider: "manual",
          institution: "Synthetic",
          name: "Other cash",
          balance: 999_999,
          currencyCode: "USD",
          ownershipType: "individual",
          ownershipShareBps: 10_000,
        },
      ])
      .returning();
    cashId = required(accounts[0]).id;
    foreignAccountId = required(accounts[1]).id;
    const transactions = await database.db
      .insert(financeTransactions)
      .values([
        {
          userId,
          accountId: cashId,
          amount: 1_000,
          direction: "expense",
          providerDirection: "expense",
          merchant: "Synthetic",
          transactionDate: "2026-09-12",
        },
        {
          userId,
          accountId: cashId,
          amount: 500,
          direction: "income",
          providerDirection: "income",
          merchant: "Synthetic credit",
          transactionDate: "2026-09-13",
        },
        {
          userId: foreignId,
          accountId: foreignAccountId,
          amount: 999_999,
          direction: "expense",
          merchant: "Private",
          transactionDate: "2026-09-12",
        },
      ])
      .returning();
    expenseId = required(transactions[0]).id;
    creditId = required(transactions[1]).id;
    service = createFinancePositionService({ db: database.db, now: () => timestamp });
  }, 120_000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });

  it("supports the detached validating port and rejects foreign account scope", async () => {
    const { readPosition } = service;
    const position = await readPosition(userId, dates);
    expect(financePositionEvidenceSchema.safeParse(position).success).toBe(true);
    expect(position.cash.cents).toBe(10_000);
    expect(position.postedSpend.cents).toBe(1_000);
    expect(position.scope.accountIds).toEqual([cashId]);
    expect(position.spendable.cents).toBeNull();
    await expect(
      readPosition(userId, { ...dates, accountIds: [foreignAccountId] }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
  it("treats explicit empty selection as none and checks ordered scope", async () => {
    const position = await service.readPosition(userId, { ...dates, accountIds: [] });
    expect(position.scope.accountIds).toEqual([]);
    expect(position.cash.cents).toBeNull();
    await expect(
      service.readPosition(userId, { ...dates, from: "2026-09-19" }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });
  it("honors only current validated tenant relationships and invalidates corrections", async () => {
    const [event] = await database.db
      .insert(financeEconomicEvents)
      .values({ userId, kind: "reimbursement", stableKey: "position-repayment" })
      .returning();
    const provenance = {
      actorId: userId,
      actorType: "user",
      confidence: null,
      evidence: {},
      maintenanceRunId: null,
      observedAt: timestamp.toISOString(),
      requestId: null,
      sourceId: null,
    };
    await database.db.insert(financeTransactionRelationships).values([
      {
        userId,
        economicEventId: required(event).id,
        relationship: "reimbursement",
        transactionIds: [expenseId, creditId],
        rationale: "Synthetic",
        provenance,
        createdAt: new Date("2026-09-18T10:00:00.000Z"),
      },
      {
        userId: foreignId,
        economicEventId: required(event).id,
        relationship: "transfer",
        transactionIds: [expenseId, creditId],
        rationale: "Foreign",
        provenance: { ...provenance, actorId: foreignId },
        createdAt: timestamp,
      },
      {
        userId,
        economicEventId: required(event).id,
        relationship: "transfer",
        transactionIds: [expenseId, creditId],
        rationale: "Malformed",
        provenance: {},
        createdAt: timestamp,
      },
    ]);
    const first = await service.readSnapshot(userId, dates);
    expect(first.position.postedSpend.cents).toBe(500);
    expect(first.activity.observedIncomeCents).toBe(0);
    await database.db.insert(financeTransactionRelationships).values({
      userId,
      economicEventId: required(event).id,
      relationship: "duplicate",
      transactionIds: [expenseId, creditId],
      rationale: "Manual correction",
      provenance,
      createdAt: new Date("2026-09-18T11:00:00.000Z"),
    });
    const second = await service.readSnapshot(userId, dates);
    expect(second.position.revision).not.toBe(first.position.revision);
    expect(second.activity.reimbursementReceivedCents).toBe(0);
    const third = await service.readPosition(userId, dates);
    expect(third.revision).toBe(second.position.revision);
    await database.db
      .update(financeAccounts)
      .set({ includeInPlanning: false, updatedAt: timestamp })
      .where(eq(financeAccounts.id, cashId));
    expect((await service.readPosition(userId, dates)).cash.cents).toBeNull();
  });
  it("preserves exactly 100 requested accounts and reports an explicit omitted-all limit", async () => {
    const [owner] = await database.db
      .insert(users)
      .values({
        displayName: "Bounded",
        email: "bounded-position@example.com",
        passwordHash: "unused",
      })
      .returning();
    const accounts = await database.db
      .insert(financeAccounts)
      .values(
        Array.from({ length: 100 }, (_, index) => ({
          userId: required(owner).id,
          provider: "manual" as const,
          institution: "Synthetic",
          name: `Cash ${index}`,
          balance: 1,
          currencyCode: "USD",
          ownershipType: "individual" as const,
          ownershipShareBps: 10_000,
        })),
      )
      .returning();
    const ids = accounts.map((account) => account.id);
    await expect(
      service.readPosition(required(owner).id, {
        ...dates,
        accountIds: [...ids, required(owner).id],
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    const position = await service.readPosition(required(owner).id, { ...dates, accountIds: ids });
    expect(position.scope.accountIds).toHaveLength(100);
    expect(position.cash.sources).toHaveLength(100);
    expect(position.spendable.sources.length).toBeLessThanOrEqual(100);
    expect(position.cash.cents).toBe(100);
    await database.db.insert(financeAccounts).values({
      userId: required(owner).id,
      provider: "manual",
      institution: "Synthetic",
      name: "Overflow",
    });
    await expect(service.readPosition(required(owner).id, dates)).rejects.toMatchObject({
      code: "invalid_request",
      message: "Select at most 100 accounts for position evidence.",
    });
    expect(
      (await service.readPosition(required(owner).id, { ...dates, accountIds: ids })).scope
        .accountIds,
    ).toHaveLength(100);
  });
});
