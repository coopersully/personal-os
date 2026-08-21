import { resolve } from "node:path";
import {
  auditEvents,
  createDatabaseClient,
  type DatabaseClient,
  financeAccounts,
  financeCategories,
  financeReimbursements,
  financeTransactionAllocations,
  financeTransactions,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createFinanceReimbursementService,
  deriveReimbursementStatus,
} from "./finance-reimbursement-service.js";
import type { Principal } from "./types.js";

const now = new Date("2026-08-17T12:00:00.000Z");
const evidence = (summary = "Receipt provided") => ({
  sourceRefs: [
    {
      accountId: null,
      provider: "local" as const,
      remoteId: "receipt",
      revision: null,
      sourceType: "local" as const,
    },
  ],
  summary,
});

describe.sequential("reimbursement lifecycle", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine")
      .withDatabase("personal_os")
      .withUsername("personal_os")
      .withPassword("personal_os")
      .start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  });

  afterAll(async () => {
    await database.close();
    await container.stop();
  });

  async function fixture() {
    const [user] = await database.db
      .insert(users)
      .values({
        displayName: "Reimbursement Test",
        email: `reimbursement-${crypto.randomUUID()}@example.com`,
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!user) throw new Error("User fixture failed.");
    const [account] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "Test Bank",
        kind: "cash",
        name: "Checking",
        provider: "manual",
        providerAccountId: crypto.randomUUID(),
        status: "manual",
        userId: user.id,
      })
      .returning();
    const [category] = await database.db
      .insert(financeCategories)
      .values({ group: "Spending", name: "Dining", slug: `dining-${user.id}`, userId: user.id })
      .returning();
    if (!account || !category) throw new Error("Ledger fixture failed.");
    const [expense] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: account.id,
        amount: 31_000,
        direction: "expense",
        merchant: "Dinner House",
        transactionDate: "2026-08-17",
        userId: user.id,
      })
      .returning();
    if (!expense) throw new Error("Expense fixture failed.");
    const [allocation] = await database.db
      .insert(financeTransactionAllocations)
      .values({
        allocationOrder: 0,
        amount: 22_000,
        categoryId: category.id,
        rationale: "Friend share",
        transactionId: expense.id,
        treatment: "reimbursable",
        userId: user.id,
      })
      .returning();
    const [credit] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: account.id,
        amount: 22_000,
        direction: "income",
        merchant: "Friend repayment",
        transactionDate: "2026-08-18",
        userId: user.id,
      })
      .returning();
    if (!allocation || !credit) throw new Error("Reimbursement fixture failed.");
    const principal: Principal = {
      actorId: user.id,
      actorType: "user",
      scopes: new Set(["finances:read", "finances:write"]),
      userId: user.id,
    };
    return { account, allocation, credit, expense, principal };
  }

  it("records multi-payer, combined-credit, and idempotent lifecycle transitions", async () => {
    const { allocation, credit, principal } = await fixture();
    const service = createFinanceReimbursementService({ db: database.db, now: () => now });
    const create = (payer: string, expectedAmount: number) =>
      service.reconcile(
        {
          allocationId: allocation.id,
          dueDate: "2026-08-19",
          evidence: evidence(`Receipt from ${payer}`),
          expectedAmount,
          operation: "create",
          payer,
          rationale: `Expected repayment from ${payer}`,
        },
        { principal, requestId: crypto.randomUUID() },
      );
    const first = await create("Alex", 100);
    const second = await create("Blair", 120);
    expect((await create("Alex", 100)).id).toBe(first.id);
    const firstMatch = await service.reconcile(
      {
        amount: 100,
        creditTransactionId: credit.id,
        evidence: evidence("Matched bank credit"),
        expectedRevision: first.revision,
        operation: "match_credit",
        rationale: "Credit identifies the reimbursement payment",
        reimbursementId: first.id,
      },
      { principal, requestId: crypto.randomUUID() },
    );
    expect(firstMatch.status).toBe("received");
    const secondMatch = await service.reconcile(
      {
        amount: 120,
        creditTransactionId: credit.id,
        evidence: evidence("Matched bank credit"),
        expectedRevision: second.revision,
        operation: "match_credit",
        rationale: "Credit identifies the reimbursement payment",
        reimbursementId: second.id,
      },
      { principal, requestId: crypto.randomUUID() },
    );
    expect(secondMatch).toMatchObject({ receivedAmount: 120, status: "received" });
    const replay = await service.reconcile(
      {
        amount: 120,
        creditTransactionId: credit.id,
        evidence: evidence("Matched bank credit"),
        expectedRevision: second.revision,
        operation: "match_credit",
        rationale: "Credit identifies the reimbursement payment",
        reimbursementId: second.id,
      },
      { principal, requestId: crypto.randomUUID() },
    );
    expect(replay.revision).toBe(secondMatch.revision);
    const broadAudits = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityType, "finance_reimbursement"));
    expect(JSON.stringify(broadAudits)).not.toContain("Alex");
    expect(JSON.stringify(broadAudits)).not.toContain("10000");
  });

  it("rolls back supplied action transactions", async () => {
    const { allocation, principal } = await fixture();
    const service = createFinanceReimbursementService({ db: database.db, now: () => now });
    await expect(
      database.db.transaction(async (tx) => {
        await service.reconcile(
          {
            allocationId: allocation.id,
            dueDate: null,
            evidence: evidence(),
            expectedAmount: 220,
            operation: "create",
            payer: "Casey",
            rationale: "Expected repayment from Casey",
          },
          { principal, requestId: crypto.randomUUID() },
          tx,
        );
        throw new Error("inject rollback");
      }),
    ).rejects.toThrow("inject rollback");
    await expect(
      database.db
        .select()
        .from(financeReimbursements)
        .where(eq(financeReimbursements.allocationId, allocation.id)),
    ).resolves.toHaveLength(0);
  });

  it("serializes concurrent expectations against one allocation", async () => {
    const { allocation, principal } = await fixture();
    const service = createFinanceReimbursementService({ db: database.db, now: () => now });
    const outcomes = await Promise.allSettled(
      ["Alex", "Blair"].map((payer) =>
        service.reconcile(
          {
            allocationId: allocation.id,
            dueDate: "2026-08-19",
            evidence: evidence(`Receipt from ${payer}`),
            expectedAmount: 220,
            operation: "create",
            payer,
            rationale: `Expected repayment from ${payer}`,
          },
          { principal, requestId: crypto.randomUUID() },
        ),
      ),
    );
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    await expect(
      database.db
        .select({ expectedAmount: financeReimbursements.expectedAmount })
        .from(financeReimbursements)
        .where(eq(financeReimbursements.allocationId, allocation.id)),
    ).resolves.toEqual([{ expectedAmount: 22_000 }]);
  });

  it("records partial receipt then idempotently cancels the unmatched remainder", async () => {
    const { allocation, credit, principal } = await fixture();
    const service = createFinanceReimbursementService({ db: database.db, now: () => now });
    const created = await service.reconcile(
      {
        allocationId: allocation.id,
        dueDate: "2026-08-19",
        evidence: evidence(),
        expectedAmount: 220,
        operation: "create",
        payer: "Casey",
        rationale: "Expected repayment from Casey",
      },
      { principal, requestId: crypto.randomUUID() },
    );
    const partial = await service.reconcile(
      {
        amount: 100,
        creditTransactionId: credit.id,
        evidence: evidence("Matched bank credit"),
        expectedRevision: created.revision,
        operation: "match_credit",
        rationale: "Credit identifies the reimbursement payment",
        reimbursementId: created.id,
      },
      { principal, requestId: crypto.randomUUID() },
    );
    expect(partial).toMatchObject({ receivedAmount: 100, status: "partially_received" });
    const cancelled = await service.reconcile(
      {
        expectedRevision: partial.revision,
        evidence: evidence("Cancellation confirmation"),
        operation: "cancel",
        rationale: "Payer cannot repay",
        reimbursementId: created.id,
      },
      { principal, requestId: crypto.randomUUID() },
    );
    expect(cancelled).toMatchObject({ receivedAmount: 100, status: "cancelled" });
    await expect(
      service.reconcile(
        {
          expectedRevision: partial.revision,
          evidence: evidence("Cancellation confirmation"),
          operation: "cancel",
          rationale: "Payer cannot repay",
          reimbursementId: created.id,
        },
        { principal, requestId: crypto.randomUUID() },
      ),
    ).resolves.toMatchObject({ revision: cancelled.revision, status: "cancelled" });
  });

  it("rejects a pending reimbursement credit for direct callers", async () => {
    const { allocation, credit, principal } = await fixture();
    const service = createFinanceReimbursementService({ db: database.db, now: () => now });
    const created = await service.reconcile(
      {
        allocationId: allocation.id,
        dueDate: null,
        evidence: evidence(),
        expectedAmount: 100,
        operation: "create",
        payer: "Casey",
        rationale: "Casey agreed to repay this share",
      },
      { principal, requestId: crypto.randomUUID() },
    );
    await database.db
      .update(financeTransactions)
      .set({ pending: true })
      .where(eq(financeTransactions.id, credit.id));
    await expect(
      service.reconcile(
        {
          amount: 100,
          creditTransactionId: credit.id,
          evidence: evidence("Pending credit evidence"),
          expectedRevision: created.revision,
          operation: "match_credit",
          rationale: "Credit should settle this reimbursement",
          reimbursementId: created.id,
        },
        { principal, requestId: crypto.randomUUID() },
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("bounds plausible credits to the oldest open expense and 500 rows", async () => {
    const { account, allocation, expense, principal } = await fixture();
    const service = createFinanceReimbursementService({ db: database.db, now: () => now });
    await service.reconcile(
      {
        allocationId: allocation.id,
        dueDate: null,
        evidence: evidence(),
        expectedAmount: 220,
        operation: "create",
        payer: "Casey",
        rationale: "Casey agreed to repay this share",
      },
      { principal, requestId: crypto.randomUUID() },
    );
    const [olderCredit, currentCredit] = await database.db
      .insert(financeTransactions)
      .values([
        {
          accountId: account.id,
          amount: 22_000,
          direction: "income",
          merchant: "Old repayment",
          transactionDate: "2026-08-16",
          userId: principal.userId,
        },
        {
          accountId: account.id,
          amount: 22_000,
          direction: "income",
          merchant: "Zelle Casey repayment",
          transactionDate: "2026-08-18",
          userId: principal.userId,
        },
      ])
      .returning();
    if (!olderCredit || !currentCredit) throw new Error("Credit fixtures failed.");

    const listed = await service.list(principal.userId);

    expect(expense.transactionDate).toBe("2026-08-17");
    expect(listed.unmatchedCredits).toEqual(
      expect.arrayContaining([expect.objectContaining({ transactionId: currentCredit.id })]),
    );
    expect(listed.unmatchedCredits).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ transactionId: olderCredit.id })]),
    );
    expect(listed.unmatchedCredits.length).toBeLessThanOrEqual(500);
  });

  it("marks overdue expected money without treating it as received", () => {
    expect(
      deriveReimbursementStatus({
        cancelledAt: null,
        dueDate: "2026-08-16",
        expectedCents: 22_000,
        receivedCents: 10_000,
        now,
      }),
    ).toBe("overdue");
  });
});
