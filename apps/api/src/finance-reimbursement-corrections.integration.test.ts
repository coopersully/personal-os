import { resolve } from "node:path";
import {
  accessTokens,
  auditEvents,
  createDatabaseClient,
  type DatabaseClient,
  executionPolicySettings,
  financeAccounts,
  financeCategories,
  financeReimbursementMatches,
  financeReimbursements,
  financeTransactionAllocations,
  financeTransactions,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { type AccessScope, financeReimbursementSchema } from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { createFinanceReimbursementService } from "./finance-reimbursement-service.js";
import type { Principal } from "./types.js";

const now = new Date("2026-10-18T12:00:00Z");
const evidence = {
  summary: "Person reviewed the source expense.",
  sourceRefs: [
    {
      provider: "local" as const,
      sourceType: "finance_transaction" as const,
      accountId: null,
      remoteId: null,
      revision: null,
    },
  ],
};
function required<T>(value: T | undefined): T {
  if (!value) throw new Error("Fixture missing");
  return value;
}
describe.sequential("Canonical reimbursement corrections", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let service: ReturnType<typeof createFinanceReimbursementService>;
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
    service = createFinanceReimbursementService({ db: database.db, now: () => now });
  }, 120_000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });
  async function fixture() {
    const owner = required(
      (
        await database.db
          .insert(users)
          .values({
            email: `correction-${crypto.randomUUID()}@example.com`,
            displayName: "Synthetic",
            passwordHash: "unused",
          })
          .returning()
      )[0],
    );
    const account = required(
      (
        await database.db
          .insert(financeAccounts)
          .values({
            userId: owner.id,
            provider: "manual",
            institution: "Synthetic",
            name: "Euro",
            currencyCode: "USD",
            balance: 100_000,
          })
          .returning()
      )[0],
    );
    const category = required(
      (
        await database.db
          .insert(financeCategories)
          .values({ userId: owner.id, name: "Shared", slug: "shared", group: "expenses" })
          .returning()
      )[0],
    );
    const expense = required(
      (
        await database.db
          .insert(financeTransactions)
          .values({
            userId: owner.id,
            accountId: account.id,
            amount: 20_000,
            currencyCode: "EUR",
            direction: "expense",
            merchant: "Shared meal",
            transactionDate: "2026-10-01",
          })
          .returning()
      )[0],
    );
    const credit = required(
      (
        await database.db
          .insert(financeTransactions)
          .values({
            userId: owner.id,
            accountId: account.id,
            amount: 5_000,
            currencyCode: "EUR",
            direction: "income",
            merchant: "Alex transfer",
            transactionDate: "2026-10-05",
          })
          .returning()
      )[0],
    );
    const allocation = required(
      (
        await database.db
          .insert(financeTransactionAllocations)
          .values({
            userId: owner.id,
            transactionId: expense.id,
            categoryId: category.id,
            amount: 12_000,
            allocationOrder: 0,
            treatment: "reimbursable",
          })
          .returning()
      )[0],
    );
    const claim = required(
      (
        await database.db
          .insert(financeReimbursements)
          .values({
            userId: owner.id,
            allocationId: allocation.id,
            expectedAmount: 10_000,
            receivedAmount: 5_000,
            status: "partially_received",
            payer: "Alex",
            rationale: "Shared meal",
            evidence,
          })
          .returning()
      )[0],
    );
    const match = required(
      (
        await database.db
          .insert(financeReimbursementMatches)
          .values({
            userId: owner.id,
            reimbursementId: claim.id,
            creditTransactionId: credit.id,
            amount: 5_000,
            rationale: "First receipt",
            evidence,
          })
          .returning()
      )[0],
    );
    const principal: Principal = {
      actorId: owner.id,
      actorType: "user",
      userId: owner.id,
      scopes: new Set<AccessScope>(["finances:read", "finances:write"]),
    };
    return {
      owner,
      account,
      expense,
      credit,
      allocation,
      claim,
      match,
      context: { principal, requestId: crypto.randomUUID() },
    };
  }
  it("allows an execution agent to correct reimbursements only under live bypass", async () => {
    const f = await fixture();
    const [token] = await database.db
      .insert(accessTokens)
      .values({
        userId: f.owner.id,
        name: "Correction agent",
        tokenHash: crypto.randomUUID(),
        scopes: ["finances:write", "finances:execute"],
      })
      .returning();
    if (!token) throw new Error("Missing token");
    await database.db
      .insert(executionPolicySettings)
      .values({ userId: f.owner.id, reviewBypassEnabled: true });
    const context = {
      principal: {
        actorType: "agent" as const,
        actorId: token.id,
        userId: f.owner.id,
        scopes: new Set(token.scopes),
      },
      requestId: "agent-correction",
    };
    const input = {
      operation: "correct_expected" as const,
      reimbursementId: f.claim.id,
      expectedRevision: 1,
      expectedAmount: 110,
      payer: "Alex corrected",
      dueDate: "2026-10-31",
      rationale: "Corrected shared share",
      evidence,
      idempotencyKey: crypto.randomUUID(),
    };
    const corrected = await service.reconcile(input, context);
    expect(corrected.expectedAmount).toBe(110);
    const [audit] = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityId, f.claim.id));
    expect(audit).toMatchObject({ actorType: "agent", actorId: token.id });
    const unmatched = await service.reconcile(
      {
        operation: "unmatch_credit",
        reimbursementId: f.claim.id,
        expectedRevision: corrected.revision,
        matchId: f.match.id,
        rationale: "Wrong receipt",
        evidence,
        idempotencyKey: crypto.randomUUID(),
      },
      context,
    );
    expect(unmatched.receivedAmount).toBe(0);
    await database.db
      .update(executionPolicySettings)
      .set({ reviewBypassEnabled: false })
      .where(eq(executionPolicySettings.userId, f.owner.id));
    await expect(
      service.reconcile(
        { ...input, expectedRevision: unmatched.revision, idempotencyKey: crypto.randomUUID() },
        context,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
  it("reads owned expense and receipt facts without substituting account currency", async () => {
    const f = await fixture();
    const result = await service.list(f.owner.id);
    const item = required(result.reimbursements[0]);
    expect(financeReimbursementSchema.safeParse(item).success).toBe(true);
    expect(item.sourceExpense).toMatchObject({
      transactionId: f.expense.id,
      amount: 200,
      allocationAmount: 120,
      currency: "EUR",
      date: "2026-10-01",
    });
    expect(item.matches[0]?.creditTransaction).toMatchObject({
      transactionId: f.credit.id,
      amount: 50,
      currency: "EUR",
      date: "2026-10-05",
    });
    expect((await service.list(crypto.randomUUID())).reimbursements).toEqual([]);
  });
  it("qualifies whole-expense EUR personal cost only after complete allocation and full ownership facts", async () => {
    const f = await fixture();
    await database.db
      .update(financeAccounts)
      .set({ ownershipType: "individual", ownershipShareBps: 10_000 })
      .where(eq(financeAccounts.id, f.account.id));
    expect(
      (await service.list(f.owner.id)).reimbursements[0]?.sourceExpense?.personalCostToDate,
    ).toEqual({ state: "unavailable", reason: "incomplete_allocations" });
    await database.db.insert(financeTransactionAllocations).values({
      userId: f.owner.id,
      transactionId: f.expense.id,
      categoryId: f.allocation.categoryId,
      amount: 8_000,
      allocationOrder: 1,
      treatment: "personal",
    });
    const item = (await service.list(f.owner.id)).reimbursements[0];
    expect(item?.sourceExpense?.personalCostToDate).toEqual({
      state: "qualified",
      amount: 150,
      receivedAmount: 50,
      currency: "EUR",
      scope: "whole_expense",
    });
    expect(financeReimbursementSchema.safeParse(item).success).toBe(true);
    await database.db
      .update(financeTransactions)
      .set({ currencyCode: "USD" })
      .where(eq(financeTransactions.id, f.credit.id));
    expect(
      (await service.list(f.owner.id)).reimbursements[0]?.sourceExpense?.personalCostToDate,
    ).toEqual({ state: "unavailable", reason: "unsupported_currency" });
  });
  it("keeps pending and shared-owner expenses out of qualified personal cost", async () => {
    const f = await fixture();
    await database.db
      .update(financeAccounts)
      .set({ ownershipType: "individual", ownershipShareBps: 10_000 })
      .where(eq(financeAccounts.id, f.account.id));
    await database.db.insert(financeTransactionAllocations).values({
      userId: f.owner.id,
      transactionId: f.expense.id,
      categoryId: f.allocation.categoryId,
      amount: 8_000,
      allocationOrder: 1,
      treatment: "personal",
    });
    await database.db
      .update(financeTransactions)
      .set({ pending: true })
      .where(eq(financeTransactions.id, f.expense.id));
    expect(
      (await service.list(f.owner.id)).reimbursements[0]?.sourceExpense?.personalCostToDate,
    ).toEqual({ state: "unavailable", reason: "pending_activity" });
    await database.db
      .update(financeTransactions)
      .set({ pending: false })
      .where(eq(financeTransactions.id, f.expense.id));
    await database.db
      .update(financeAccounts)
      .set({ ownershipType: "joint", ownershipShareBps: 5_000 })
      .where(eq(financeAccounts.id, f.account.id));
    expect(
      (await service.list(f.owner.id)).reimbursements[0]?.sourceExpense?.personalCostToDate,
    ).toEqual({ state: "unavailable", reason: "unknown_ownership" });
    expect((await service.list(crypto.randomUUID())).reimbursements).toEqual([]);
  });
  it("corrects the existing expectation, preserves receipts and replays one receipt", async () => {
    const f = await fixture();
    const input = {
      operation: "correct_expected" as const,
      reimbursementId: f.claim.id,
      expectedRevision: 1,
      expectedAmount: 110,
      payer: "Alex corrected",
      dueDate: "2026-10-31",
      rationale: "Corrected shared share",
      evidence,
      idempotencyKey: crypto.randomUUID(),
    };
    const result = await service.reconcile(input, f.context);
    expect(result).toMatchObject({
      id: f.claim.id,
      expectedAmount: 110,
      receivedAmount: 50,
      revision: 2,
      payer: "Alex corrected",
    });
    expect(await service.reconcile(input, f.context)).toEqual(result);
    expect((await service.list(f.owner.id)).reimbursements[0]?.corrections).toMatchObject([
      { operation: "correct_expected", previousExpectedAmount: 100, expectedAmount: 110 },
    ]);
    await expect(
      service.reconcile({ ...input, expectedAmount: 105 }, f.context),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });
  it("unmatches once, restores capacity and retains full removed evidence in audit history", async () => {
    const f = await fixture();
    const input = {
      operation: "unmatch_credit" as const,
      reimbursementId: f.claim.id,
      expectedRevision: 1,
      matchId: f.match.id,
      rationale: "Wrong credit selected",
      evidence,
      idempotencyKey: crypto.randomUUID(),
    };
    const result = await service.reconcile(input, f.context);
    expect(result).toMatchObject({
      id: f.claim.id,
      receivedAmount: 0,
      revision: 2,
      status: "expected",
      matches: [],
    });
    expect(await service.reconcile(input, f.context)).toEqual(result);
    const listed = required((await service.list(f.owner.id)).reimbursements[0]);
    expect(listed.corrections?.[0]?.removedMatch).toMatchObject({
      id: f.match.id,
      creditTransactionId: f.credit.id,
      amount: 50,
      rationale: "First receipt",
    });
    expect(
      await database.db
        .select()
        .from(financeTransactions)
        .where(eq(financeTransactions.id, f.credit.id)),
    ).toHaveLength(1);
    expect(
      await database.db.select().from(auditEvents).where(eq(auditEvents.entityId, f.claim.id)),
    ).toHaveLength(1);
  });
  it("rejects stale, over-capacity and below-receipts corrections atomically", async () => {
    const f = await fixture();
    const input = {
      operation: "correct_expected" as const,
      reimbursementId: f.claim.id,
      expectedRevision: 1,
      expectedAmount: 110,
      payer: null,
      dueDate: null,
      rationale: "Correction",
      evidence,
    };
    for (const delta of [
      { expectedRevision: 2 },
      { expectedAmount: 121 },
      { expectedAmount: 49 },
    ]) {
      await expect(
        service.reconcile({ ...input, ...delta, idempotencyKey: crypto.randomUUID() }, f.context),
      ).rejects.toBeDefined();
    }
    expect(required((await service.list(f.owner.id)).reimbursements[0])).toMatchObject({
      expectedAmount: 100,
      receivedAmount: 50,
      revision: 1,
    });
    expect(
      await database.db.select().from(auditEvents).where(eq(auditEvents.entityId, f.claim.id)),
    ).toHaveLength(0);
  });
  it("rejects agent replay before completed-receipt lookup and cross-owner targeting", async () => {
    const f = await fixture();
    const input = {
      operation: "unmatch_credit" as const,
      reimbursementId: f.claim.id,
      expectedRevision: 1,
      matchId: f.match.id,
      rationale: "Wrong credit",
      evidence,
      idempotencyKey: crypto.randomUUID(),
    };
    await service.reconcile(input, f.context);
    await expect(
      service.reconcile(input, {
        ...f.context,
        principal: { ...f.context.principal, actorType: "agent", actorId: "agent" },
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    const other = await fixture();
    await expect(
      service.reconcile({ ...input, idempotencyKey: crypto.randomUUID() }, other.context),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
