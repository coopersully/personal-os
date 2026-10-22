import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  financeAccounts,
  financeBalanceInclusions,
  financeCashBalanceBases,
  financeCategories,
  financeEconomicEvents,
  financeIncomeStreams,
  financeOccurrenceMatchEvents,
  financeRecurringObligations,
  financeRecurringOccurrences,
  financeReimbursementMatches,
  financeReimbursements,
  financeTransactionAllocations,
  financeTransactionRelationships,
  financeTransactions,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { createFinanceService } from "../finance-service.js";
import type { FinanceMutationContext } from "./context.js";

describe.sequential("recurring schedule actual matching and explicit balance basis", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  const now = () => new Date("2026-03-01T12:00:00Z");
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120_000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });
  async function fixture() {
    const [user] = await database.db
      .insert(users)
      .values({
        email: `occurrence-${randomUUID()}@nohmi.test`,
        displayName: "Synthetic occurrence",
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!user) throw new Error("Missing user");
    const [account] = await database.db
      .insert(financeAccounts)
      .values({
        userId: user.id,
        name: "Synthetic cash",
        institution: "Local fixture",
        provider: "manual",
        kind: "cash",
        currencyCode: "USD",
        ownershipType: "individual",
        ownershipShareBps: 10000,
        includeInPlanning: true,
      })
      .returning();
    if (!account) throw new Error("Missing account");
    const [income] = await database.db
      .insert(financeIncomeStreams)
      .values({
        userId: user.id,
        accountId: account.id,
        payer: "synthetic salary",
        displayName: "Synthetic salary",
        cadence: "monthly",
        expectedAmount: 300000,
        amountTolerance: 0,
        confidence: 10000,
        source: "user",
        status: "active",
      })
      .returning();
    const [obligation] = await database.db
      .insert(financeRecurringObligations)
      .values({
        userId: user.id,
        accountId: account.id,
        merchant: "synthetic rent",
        displayName: "Synthetic weekly bill",
        cadence: "weekly",
        kind: "bill",
        expectedAmount: 10000,
        amountTolerance: 0,
        confidence: 10000,
        source: "user",
        status: "active",
      })
      .returning();
    const [category] = await database.db
      .insert(financeCategories)
      .values({ userId: user.id, name: "Rent", slug: "rent", group: "needs" })
      .returning();
    const [actual] = await database.db
      .insert(financeTransactions)
      .values({
        userId: user.id,
        accountId: account.id,
        merchant: "Synthetic bill",
        amount: 10000,
        currencyCode: "USD",
        direction: "expense",
        transactionDate: "2026-03-01",
        category: "Rent",
        categorySource: "user",
        categoryConfidence: 10000,
      })
      .returning();
    if (!income || !obligation || !category || !actual) throw new Error("Missing sources");
    const [allocation] = await database.db
      .insert(financeTransactionAllocations)
      .values({
        userId: user.id,
        transactionId: actual.id,
        categoryId: category.id,
        amount: 10000,
        allocationOrder: 0,
        treatment: "personal",
      })
      .returning();
    if (!allocation) throw new Error("Missing allocation");
    const context: FinanceMutationContext = {
      userId: user.id,
      actorId: user.id,
      actorType: "user",
      canMutate: true,
      canSelfApprove: false,
      bypassEnabled: false,
      requestId: randomUUID(),
    };
    const service = createFinanceService({ db: database.db, now });
    const costInput = {
      source: { kind: "obligation" as const, id: obligation.id },
      accountId: account.id,
      expectedSourceRevision: 1,
      cadence: "weekly" as const,
      timezone: "UTC",
      anchorLocalDate: "2026-02-01",
      effectiveFrom: "2026-02-01",
      semimonthlyDays: null,
      amountBasis: "fixed" as const,
      amountCents: 10000,
      currencyCode: "USD",
      supersedesId: null,
      idempotencyKey: randomUUID(),
    };
    const cost = await service.confirmFinanceRecurringSchedule(costInput, context);
    await service.confirmFinanceRecurringSchedule(
      {
        source: { kind: "income", id: income.id },
        accountId: account.id,
        expectedSourceRevision: 1,
        cadence: "monthly",
        timezone: "UTC",
        anchorLocalDate: "2026-01-31",
        effectiveFrom: "2026-02-01",
        semimonthlyDays: null,
        amountBasis: "fixed",
        amountCents: 300000,
        currencyCode: "USD",
        supersedesId: null,
        idempotencyKey: randomUUID(),
      },
      context,
    );
    const match = {
      operation: "match_expense" as const,
      occurrence: { scheduleVersionId: cost.data.id, localDate: "2026-03-01", slot: 0 },
      transactionId: actual.id,
      expectedTransactionRevision: actual.contextualRevision.toString(),
      expectedReimbursementRelationshipRevision:
        actual.reimbursementRelationshipRevision.toString(),
      allocationId: allocation.id,
      expectedAllocationRevision: allocation.revision,
      amountCents: 10000,
      currencyCode: "USD",
      rationale: "Explicit synthetic bill actual",
      idempotencyKey: randomUUID(),
    };
    return {
      user,
      account,
      income,
      obligation,
      actual,
      allocation,
      context,
      service,
      cost,
      costInput,
      match,
    };
  }
  async function statement(f: Awaited<ReturnType<typeof fixture>>) {
    const sources = await f.service.listFinanceBalanceBasisSources(f.user.id, {
      accountIds: [f.account.id],
    });
    expect(sources.coverage).toMatchObject({ complete: true, truncated: false });
    return f.service.confirmFinanceBalanceBasis(
      {
        accountId: f.account.id,
        kind: "current",
        amountCents: 100000,
        currencyCode: "USD",
        asOf: now().toISOString(),
        validUntil: "2026-05-01T00:00:00Z",
        protectedFloorCents: 0,
        expectedAccountRevision: f.account.contextualRevision.toString(),
        expectedBasisRevision: 0,
        reflections: sources.transactions.map((row) => ({
          transactionId: row.id,
          transactionRevision: row.transactionRevision,
          reimbursementRelationshipRevision: row.reimbursementRelationshipRevision,
          reflection: "included" as const,
        })),
        idempotencyKey: randomUUID(),
      },
      f.context,
    );
  }
  async function closePreviousPayday(f: Awaited<ReturnType<typeof fixture>>) {
    const [salary] = await database.db
      .insert(financeTransactions)
      .values({
        userId: f.user.id,
        accountId: f.account.id,
        merchant: "Synthetic salary",
        amount: 300000,
        currencyCode: "USD",
        direction: "income",
        transactionDate: "2026-02-28",
        category: "Income",
        categorySource: "user",
        categoryConfidence: 10000,
      })
      .returning();
    if (!salary) throw new Error("Missing synthetic salary");
    const schedule = await f.service.listFinanceRecurringOccurrences(f.user.id, {
      from: "2026-02-28",
      to: "2026-02-28",
    });
    const payday = schedule.occurrences.find((row) => row.source.kind === "income");
    if (!payday) throw new Error("Missing previous payday");
    await f.service.manageFinanceOccurrenceMatch(
      {
        operation: "match_income",
        occurrence: {
          scheduleVersionId: payday.scheduleVersionId,
          localDate: payday.localDate,
          slot: payday.slot,
        },
        transactionId: salary.id,
        expectedTransactionRevision: salary.contextualRevision.toString(),
        expectedReimbursementRelationshipRevision:
          salary.reimbursementRelationshipRevision.toString(),
        amountCents: 300000,
        currencyCode: "USD",
        rationale: "Explicit previous salary",
        idempotencyKey: randomUUID(),
      },
      f.context,
    );
  }

  it("reviews historical current revisions separately and refuses an incomplete balance statement", async () => {
    const f = await fixture();
    const [old] = await database.db
      .insert(financeTransactions)
      .values({
        userId: f.user.id,
        accountId: f.account.id,
        merchant: "Historical included expense",
        amount: 500,
        currencyCode: "USD",
        direction: "expense",
        transactionDate: "2025-01-01",
        category: "Rent",
        categorySource: "user",
      })
      .returning();
    const timeline = await f.service.listFinanceCashflowSources(f.user.id, {
      from: "2026-03-01",
      to: "2026-03-31",
    });
    expect(timeline.transactions.map((row) => row.id)).not.toContain(old?.id);
    const review = await f.service.listFinanceBalanceBasisSources(f.user.id, {
      accountIds: [f.account.id],
    });
    expect(review.transactions.map((row) => row.id)).toContain(old?.id);
    expect(
      (await f.service.listFinanceBalanceBasisSources(f.user.id, { accountIds: [] })).transactions,
    ).toEqual([]);
    await expect(
      f.service.confirmFinanceBalanceBasis(
        {
          accountId: f.account.id,
          kind: "current",
          amountCents: 100000,
          currencyCode: "USD",
          asOf: now().toISOString(),
          validUntil: "2026-05-01T00:00:00Z",
          protectedFloorCents: 0,
          expectedAccountRevision: f.account.contextualRevision.toString(),
          expectedBasisRevision: 0,
          reflections: [
            {
              transactionId: f.actual.id,
              transactionRevision: f.actual.contextualRevision.toString(),
              reimbursementRelationshipRevision:
                f.actual.reimbursementRelationshipRevision.toString(),
              reflection: "included",
            },
          ],
          idempotencyKey: randomUUID(),
        },
        f.context,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await f.service.manageFinanceOccurrenceMatch(f.match, f.context);
    await statement(f);
    const view = await f.service.getFinanceCashflowProjection(f.user.id, {
      from: "2026-03-01",
      to: "2026-04-30",
      selectedIncomeStreamId: f.income.id,
    });
    expect(view.projection).toMatchObject({ status: "estimated", endingBalanceMinorUnits: 360000 });
  });

  it("shares one canonical allocation capacity across two occurrence matches without double cash", async () => {
    const f = await fixture();
    await f.service.manageFinanceOccurrenceMatch({ ...f.match, amountCents: 4000 }, f.context);
    await f.service.manageFinanceOccurrenceMatch(
      {
        ...f.match,
        occurrence: { ...f.match.occurrence, localDate: "2026-03-08" },
        amountCents: 6000,
        idempotencyKey: randomUUID(),
      },
      f.context,
    );
    await statement(f);
    expect(
      (
        await f.service.getFinanceCashflowProjection(f.user.id, {
          from: "2026-03-01",
          to: "2026-04-30",
          selectedIncomeStreamId: f.income.id,
        })
      ).projection,
    ).toMatchObject({ status: "estimated", endingBalanceMinorUnits: 360000 });
  });

  it("preserves separate canonical allocation identities for multiple matches to one transaction", async () => {
    const f = await fixture();
    await database.db
      .update(financeTransactionAllocations)
      .set({ state: "invalidated" })
      .where(eq(financeTransactionAllocations.id, f.allocation.id));
    const allocations = await database.db
      .insert(financeTransactionAllocations)
      .values(
        [4000, 6000].map((amount, allocationOrder) => ({
          userId: f.user.id,
          transactionId: f.actual.id,
          categoryId: f.allocation.categoryId,
          amount,
          allocationOrder,
          treatment: "personal" as const,
        })),
      )
      .returning();
    for (const allocation of allocations)
      await f.service.manageFinanceOccurrenceMatch(
        {
          ...f.match,
          allocationId: allocation.id,
          expectedAllocationRevision: allocation.revision,
          amountCents: allocation.amount,
          idempotencyKey: randomUUID(),
        },
        f.context,
      );
    await statement(f);
    expect(
      (
        await f.service.getFinanceCashflowProjection(f.user.id, {
          from: "2026-03-01",
          to: "2026-04-30",
          selectedIncomeStreamId: f.income.id,
        })
      ).projection,
    ).toMatchObject({ status: "estimated", endingBalanceMinorUnits: 360000 });
  });

  it("retains an unpaid fixed predecessor before its successor boundary and withholds the estimate", async () => {
    const f = await fixture();
    await f.service.confirmFinanceRecurringSchedule(
      {
        ...f.costInput,
        expectedSourceRevision: 2,
        supersedesId: f.cost.data.id,
        effectiveFrom: "2026-03-01",
        anchorLocalDate: "2026-03-01",
        amountCents: 12000,
        idempotencyKey: randomUUID(),
      },
      f.context,
    );
    await closePreviousPayday(f);
    await statement(f);
    const view = await f.service.getFinanceCashflowProjection(f.user.id, {
      from: "2026-02-22",
      to: "2026-03-31",
      selectedIncomeStreamId: f.income.id,
    });
    expect(
      view.schedule.occurrences.find(
        (row) => row.scheduleVersionId === f.cost.data.id && row.localDate === "2026-02-22",
      ),
    ).toMatchObject({ inCurrentSchedule: true, remainingExpectedCents: 10000 });
    expect(view.projection.status).toBe("unavailable");
    expect(
      view.projection.status === "unavailable" &&
        view.projection.reasons.map((reason) => reason.code),
    ).toContain("overdue_expected");
  });

  it("keeps a reversed unpaid variable predecessor unknown inside its original effective interval", async () => {
    const f = await fixture();
    const variable = await f.service.confirmFinanceRecurringSchedule(
      {
        ...f.costInput,
        expectedSourceRevision: 2,
        supersedesId: f.cost.data.id,
        effectiveFrom: "2026-02-15",
        anchorLocalDate: "2026-02-15",
        amountBasis: "variable",
        idempotencyKey: randomUUID(),
      },
      f.context,
    );
    const match = await f.service.manageFinanceOccurrenceMatch(
      {
        ...f.match,
        occurrence: { scheduleVersionId: variable.data.id, localDate: "2026-02-22", slot: 0 },
      },
      f.context,
    );
    await f.service.manageFinanceOccurrenceMatch(
      {
        operation: "reverse",
        matchId: match.data.id,
        rationale: "Correct variable schedule",
        idempotencyKey: randomUUID(),
      },
      f.context,
    );
    await f.service.confirmFinanceRecurringSchedule(
      {
        ...f.costInput,
        expectedSourceRevision: 3,
        supersedesId: variable.data.id,
        effectiveFrom: "2026-03-01",
        anchorLocalDate: "2026-03-01",
        idempotencyKey: randomUUID(),
      },
      f.context,
    );
    await closePreviousPayday(f);
    await statement(f);
    const view = await f.service.getFinanceCashflowProjection(f.user.id, {
      from: "2026-02-22",
      to: "2026-04-30",
      selectedIncomeStreamId: f.income.id,
    });
    expect(
      view.schedule.occurrences.some(
        (row) => row.scheduleVersionId === variable.data.id && row.amountBasis === "variable",
      ),
    ).toBe(true);
    expect(view.schedule.matchEvents.some((row) => row.kind === "reverse")).toBe(true);
    expect(
      view.schedule.occurrences.find(
        (row) => row.scheduleVersionId === variable.data.id && row.localDate === "2026-02-22",
      ),
    ).toMatchObject({ inCurrentSchedule: true, remainingExpectedCents: 10000 });
    expect(view.projection.status).toBe("unavailable");
    expect(
      view.projection.status === "unavailable" &&
        view.projection.reasons.map((reason) => reason.code),
    ).toContain("unknown_amount");
  });

  it("uses today's next payday while retaining reversed variable history outside its effective interval", async () => {
    const f = await fixture();
    const variable = await f.service.confirmFinanceRecurringSchedule(
      {
        ...f.costInput,
        expectedSourceRevision: 2,
        supersedesId: f.cost.data.id,
        effectiveFrom: "2026-02-15",
        anchorLocalDate: "2026-02-15",
        amountBasis: "variable",
        idempotencyKey: randomUUID(),
      },
      f.context,
    );
    const match = await f.service.manageFinanceOccurrenceMatch(
      {
        ...f.match,
        occurrence: { scheduleVersionId: variable.data.id, localDate: "2026-03-01", slot: 0 },
      },
      f.context,
    );
    await f.service.manageFinanceOccurrenceMatch(
      {
        operation: "reverse",
        matchId: match.data.id,
        rationale: "Correct variable schedule",
        idempotencyKey: randomUUID(),
      },
      f.context,
    );
    await f.service.confirmFinanceRecurringSchedule(
      {
        ...f.costInput,
        expectedSourceRevision: 3,
        supersedesId: variable.data.id,
        effectiveFrom: "2026-03-01",
        anchorLocalDate: "2026-03-01",
        idempotencyKey: randomUUID(),
      },
      f.context,
    );
    await closePreviousPayday(f);
    await statement(f);
    const view = await f.service.getFinanceCashflowProjection(f.user.id, {
      from: "2026-02-28",
      to: "2026-04-30",
      selectedIncomeStreamId: f.income.id,
    });
    expect(
      view.schedule.occurrences.some(
        (row) => row.scheduleVersionId === variable.data.id && row.amountBasis === "variable",
      ),
    ).toBe(true);
    expect(view.schedule.matchEvents.some((row) => row.kind === "reverse")).toBe(true);
    expect(
      view.schedule.occurrences.find(
        (row) => row.scheduleVersionId === variable.data.id && row.localDate === "2026-03-01",
      ),
    ).toMatchObject({ inCurrentSchedule: false, remainingExpectedCents: 0 });
    expect(view.projection).toMatchObject({ status: "estimated", endingBalanceMinorUnits: 350000 });
  });

  it("retains historical irregular disclosure without blocking a fixed successor's current forecast", async () => {
    const f = await fixture();
    const irregular = await f.service.confirmFinanceRecurringSchedule(
      {
        ...f.costInput,
        expectedSourceRevision: 2,
        supersedesId: f.cost.data.id,
        effectiveFrom: "2026-02-15",
        cadence: "irregular",
        idempotencyKey: randomUUID(),
      },
      f.context,
    );
    await f.service.confirmFinanceRecurringSchedule(
      {
        ...f.costInput,
        expectedSourceRevision: 3,
        supersedesId: irregular.data.id,
        effectiveFrom: "2026-03-01",
        anchorLocalDate: "2026-03-01",
        idempotencyKey: randomUUID(),
      },
      f.context,
    );
    await closePreviousPayday(f);
    await statement(f);
    const view = await f.service.getFinanceCashflowProjection(f.user.id, {
      from: "2026-02-22",
      to: "2026-04-30",
      selectedIncomeStreamId: f.income.id,
    });
    expect(view.schedule.unavailableSources).toContainEqual({
      source: f.costInput.source,
      reason: "irregular_cadence",
    });
    expect(view.projection).toMatchObject({ status: "estimated", endingBalanceMinorUnits: 350000 });
    const current = await f.service.listFinanceRecurringOccurrences(f.user.id, {
      from: "2026-03-01",
      to: "2026-03-31",
    });
    expect(current.unavailableSources).not.toContainEqual({
      source: f.costInput.source,
      reason: "irregular_cadence",
    });
  });

  it("does not classify out-of-scope cash or unexplained in-scope actuals as eligible projection cash", async () => {
    const f = await fixture();
    const [excludedAccount] = await database.db
      .insert(financeAccounts)
      .values({
        userId: f.user.id,
        name: "Unselected synthetic account",
        institution: "Local fixture",
        provider: "manual",
        kind: "cash",
        currencyCode: "USD",
        includeInPlanning: true,
      })
      .returning();
    if (!excludedAccount) throw new Error("Missing excluded account");
    await database.db.insert(financeTransactions).values({
      userId: f.user.id,
      accountId: excludedAccount.id,
      merchant: "Out of scope unclassified cash",
      amount: 500,
      currencyCode: "USD",
      direction: "expense",
      transactionDate: "2026-03-01",
      category: null,
    });
    await f.service.manageFinanceOccurrenceMatch(f.match, f.context);
    await statement(f);
    const query = {
      from: "2026-03-01",
      to: "2026-04-30",
      accountIds: [f.account.id],
      selectedIncomeStreamId: f.income.id,
    };
    expect((await f.service.getFinanceCashflowProjection(f.user.id, query)).projection.status).toBe(
      "estimated",
    );
    await database.db
      .update(financeTransactions)
      .set({ category: null })
      .where(eq(financeTransactions.id, f.actual.id));
    expect((await f.service.getFinanceCashflowProjection(f.user.id, query)).projection.status).toBe(
      "unavailable",
    );
  });

  it("binds both actual generations so a reimbursement graph ABA cannot resurrect an old match or replay stale input", async () => {
    const f = await fixture();
    const [credit] = await database.db
      .insert(financeTransactions)
      .values({
        userId: f.user.id,
        accountId: f.account.id,
        merchant: "Explicit synthetic income",
        amount: 10000,
        currencyCode: "USD",
        direction: "income",
        transactionDate: "2026-03-01",
        category: "Income",
        categorySource: "user",
      })
      .returning();
    if (!credit) throw new Error("Missing credit");
    const schedule = await f.service.listFinanceRecurringOccurrences(f.user.id, {
      from: "2026-03-31",
      to: "2026-03-31",
    });
    const payday = schedule.occurrences.find((row) => row.source.kind === "income");
    if (!payday) throw new Error("Missing payday");
    const input = {
      operation: "match_income" as const,
      occurrence: {
        scheduleVersionId: payday.scheduleVersionId,
        localDate: payday.localDate,
        slot: payday.slot,
      },
      transactionId: credit.id,
      expectedTransactionRevision: credit.contextualRevision.toString(),
      expectedReimbursementRelationshipRevision:
        credit.reimbursementRelationshipRevision.toString(),
      amountCents: 10000,
      currencyCode: "USD",
      rationale: "Explicit income before relationship change",
      idempotencyKey: randomUUID(),
    };
    const matched = await f.service.manageFinanceOccurrenceMatch(input, f.context);
    expect(matched.data.reimbursementRelationshipRevision).toBe(
      credit.reimbursementRelationshipRevision.toString(),
    );
    await statement(f);
    await database.db
      .update(financeTransactionAllocations)
      .set({ treatment: "reimbursable" })
      .where(eq(financeTransactionAllocations.id, f.allocation.id));
    const [reimbursement] = await database.db
      .insert(financeReimbursements)
      .values({
        userId: f.user.id,
        allocationId: f.allocation.id,
        expectedAmount: 10000,
        rationale: "Synthetic reimbursement",
      })
      .returning();
    if (!reimbursement) throw new Error("Missing reimbursement");
    const [link] = await database.db
      .insert(financeReimbursementMatches)
      .values({
        userId: f.user.id,
        reimbursementId: reimbursement.id,
        creditTransactionId: credit.id,
        amount: 10000,
        rationale: "Synthetic graph transition",
      })
      .returning();
    if (!link) throw new Error("Missing graph link");
    await database.db
      .delete(financeReimbursementMatches)
      .where(eq(financeReimbursementMatches.id, link.id));
    const [current] = await database.db
      .select()
      .from(financeTransactions)
      .where(eq(financeTransactions.id, credit.id));
    expect(current?.contextualRevision).toBe(credit.contextualRevision);
    expect(current?.reimbursementRelationshipRevision).toBeGreaterThan(
      credit.reimbursementRelationshipRevision,
    );
    const view = await f.service.listFinanceRecurringOccurrences(f.user.id, {
      from: "2026-03-31",
      to: "2026-03-31",
    });
    expect(view.occurrences.find((row) => row.source.kind === "income")?.matchState).toBe(
      "invalidated",
    );
    await expect(
      f.service.manageFinanceOccurrenceMatch({ ...input, idempotencyKey: randomUUID() }, f.context),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(
      (
        await f.service.getFinanceCashflowProjection(f.user.id, {
          from: "2026-03-01",
          to: "2026-03-31",
          selectedIncomeStreamId: f.income.id,
        })
      ).projection.status,
    ).toBe("unavailable");
  });

  it.each([
    "repayment",
    "refund",
  ] as const)("keeps an included canonical %s in opening cash without adding recurring income", async (kind) => {
    const f = await fixture();
    const [credit] = await database.db
      .insert(financeTransactions)
      .values({
        userId: f.user.id,
        accountId: f.account.id,
        merchant: `Synthetic ${kind}`,
        amount: 2000,
        currencyCode: "USD",
        direction: "income",
        transactionDate: "2026-03-01",
        category: "Income",
        categorySource: "user",
      })
      .returning();
    if (!credit) throw new Error("Missing credit");
    if (kind === "repayment") {
      await database.db
        .update(financeTransactionAllocations)
        .set({ treatment: "reimbursable" })
        .where(eq(financeTransactionAllocations.id, f.allocation.id));
      const [reimbursement] = await database.db
        .insert(financeReimbursements)
        .values({
          userId: f.user.id,
          allocationId: f.allocation.id,
          expectedAmount: 10000,
          receivedAmount: 2000,
          status: "partially_received",
          rationale: "Synthetic repayment",
        })
        .returning();
      if (!reimbursement) throw new Error("Missing reimbursement");
      await database.db.insert(financeReimbursementMatches).values({
        userId: f.user.id,
        reimbursementId: reimbursement.id,
        creditTransactionId: credit.id,
        amount: 2000,
        rationale: "Synthetic repayment link",
      });
    } else {
      const [event] = await database.db
        .insert(financeEconomicEvents)
        .values({ userId: f.user.id, kind: "refund", stableKey: randomUUID() })
        .returning();
      if (!event) throw new Error("Missing refund event");
      await database.db.insert(financeTransactionRelationships).values({
        userId: f.user.id,
        economicEventId: event.id,
        relationship: "refund",
        transactionIds: [f.actual.id, credit.id],
        rationale: "Explicit synthetic refund",
        provenance: {
          actorId: f.user.id,
          actorType: "user",
          confidence: 1,
          evidence: {},
          maintenanceRunId: null,
          observedAt: now().toISOString(),
          requestId: randomUUID(),
          sourceId: null,
        },
      });
    }
    const sources = await f.service.listFinanceBalanceBasisSources(f.user.id, {
      accountIds: [f.account.id],
    });
    const currentCredit = sources.transactions.find((row) => row.id === credit.id);
    expect(currentCredit?.incomeEligibility).toEqual({
      eligible: false,
      reasons: ["reimbursement_or_refund_credit"],
    });
    await statement(f);
    const view = await f.service.getFinanceCashflowProjection(f.user.id, {
      from: "2026-03-01",
      to: "2026-03-31",
      selectedIncomeStreamId: f.income.id,
    });
    expect(view.projection).toMatchObject({
      status: "estimated",
      openingBalanceMinorUnits: 100000,
      endingBalanceMinorUnits: 350000,
      expectedEndPaydayIncomeMinorUnits: 300000,
    });
    expect(
      view.projection.status === "estimated" &&
        view.projection.evidence.actualMovements.some(
          (row) => row.id === `transaction:${credit.id}`,
        ),
    ).toBe(false);
    const payday = view.schedule.occurrences.find((row) => row.source.kind === "income");
    if (!payday || !currentCredit) throw new Error("Missing current income source");
    await expect(
      f.service.manageFinanceOccurrenceMatch(
        {
          operation: "match_income",
          occurrence: {
            scheduleVersionId: payday.scheduleVersionId,
            localDate: payday.localDate,
            slot: payday.slot,
          },
          transactionId: credit.id,
          expectedTransactionRevision: currentCredit.transactionRevision,
          expectedReimbursementRelationshipRevision:
            currentCredit.reimbursementRelationshipRevision,
          amountCents: 2000,
          currencyCode: "USD",
          rationale: "Must not become recurring income",
          idempotencyKey: randomUUID(),
        },
        f.context,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("keeps legacy NULL balance reflection generations unknown without inventing a current revision", async () => {
    const f = await fixture();
    // Seed a pre-generation legacy statement without mutating immutable history.
    const [legacy] = await database.db
      .insert(financeCashBalanceBases)
      .values({
        userId: f.user.id,
        actorUserId: f.user.id,
        accountId: f.account.id,
        basisRevision: 1,
        accountContextualRevision: f.account.contextualRevision,
        kind: "current",
        amountCents: 100000,
        currencyCode: "USD",
        asOf: now(),
        validUntil: new Date("2026-05-01T00:00:00Z"),
        protectedFloorCents: 0,
      })
      .returning();
    if (!legacy) throw new Error("Missing legacy basis");
    await database.db.insert(financeBalanceInclusions).values({
      userId: f.user.id,
      basisId: legacy.id,
      transactionId: f.actual.id,
      transactionContextualRevision: f.actual.contextualRevision,
      reflection: "included",
    });
    const bases = await f.service.listFinanceBalanceBases(f.user.id, [f.account.id]);
    expect(bases[0]?.reflections[0]?.reimbursementRelationshipRevision).toBeNull();
    const view = await f.service.getFinanceCashflowProjection(f.user.id, {
      from: "2026-03-01",
      to: "2026-03-31",
      selectedIncomeStreamId: f.income.id,
    });
    expect(view.projection).toMatchObject({
      status: "unavailable",
      reasons: [{ code: "actual_review_required" }],
    });
  });

  it("expands stable month-end identities without creating occurrence rows on reads", async () => {
    const f = await fixture();
    const broad = await f.service.listFinanceRecurringOccurrences(f.user.id, {
      from: "2026-03-01",
      to: "2026-04-30",
    });
    const narrow = await f.service.listFinanceRecurringOccurrences(f.user.id, {
      from: "2026-03-31",
      to: "2026-04-01",
    });
    expect(narrow.occurrences.find((row) => row.source.kind === "income")?.key).toBe(
      broad.occurrences.find(
        (row) => row.source.kind === "income" && row.localDate === "2026-03-31",
      )?.key,
    );
    expect(
      broad.occurrences.some(
        (row) => row.source.kind === "income" && row.localDate === "2026-04-30",
      ),
    ).toBe(true);
    expect(
      await database.db
        .select()
        .from(financeRecurringOccurrences)
        .where(eq(financeRecurringOccurrences.userId, f.user.id)),
    ).toHaveLength(0);
  });
  it("matches once, replays once and records a full immutable one-time reversal", async () => {
    const f = await fixture();
    const first = await f.service.manageFinanceOccurrenceMatch(f.match, f.context);
    expect(await f.service.manageFinanceOccurrenceMatch(f.match, f.context)).toEqual(first);
    const view = await f.service.listFinanceRecurringOccurrences(f.user.id, {
      from: "2026-03-01",
      to: "2026-03-01",
    });
    expect(view.occurrences[0]).toMatchObject({
      matchState: "matched",
      matchedAmountCents: 10000,
      remainingExpectedCents: 0,
    });
    expect(view.matchEvents).toHaveLength(1);
    const reversal = {
      operation: "reverse" as const,
      matchId: first.data.id,
      rationale: "Explicit full reversal",
      idempotencyKey: randomUUID(),
    };
    const reversed = await f.service.manageFinanceOccurrenceMatch(reversal, f.context);
    expect(reversed.data).toMatchObject({
      kind: "reverse",
      amountCents: 10000,
      reversesMatchId: first.data.id,
    });
    await expect(
      f.service.manageFinanceOccurrenceMatch(
        { ...reversal, idempotencyKey: randomUUID() },
        f.context,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(
      (
        await f.service.listFinanceRecurringOccurrences(f.user.id, {
          from: "2026-03-01",
          to: "2026-03-01",
        })
      ).matchEvents,
    ).toHaveLength(2);
  });
  it("serializes competing capacity claims under topology locks", async () => {
    const f = await fixture();
    const outcomes = await Promise.allSettled([
      f.service.manageFinanceOccurrenceMatch({ ...f.match, amountCents: 6000 }, f.context),
      f.service.manageFinanceOccurrenceMatch(
        { ...f.match, amountCents: 6000, idempotencyKey: randomUUID() },
        f.context,
      ),
    ]);
    expect(outcomes.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((row) => row.status === "rejected")).toHaveLength(1);
    expect(
      await database.db
        .select()
        .from(financeOccurrenceMatchEvents)
        .where(eq(financeOccurrenceMatchEvents.userId, f.user.id)),
    ).toHaveLength(1);
  });
  it("rejects pending and cross-owner actuals before materializing a fake identity", async () => {
    const f = await fixture();
    await database.db
      .update(financeTransactions)
      .set({ pending: true })
      .where(eq(financeTransactions.id, f.actual.id));
    await expect(f.service.manageFinanceOccurrenceMatch(f.match, f.context)).rejects.toMatchObject({
      code: "conflict",
    });
    const other = await fixture();
    await expect(
      f.service.manageFinanceOccurrenceMatch(
        { ...f.match, idempotencyKey: randomUUID() },
        other.context,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(
      await database.db
        .select()
        .from(financeRecurringOccurrences)
        .where(eq(financeRecurringOccurrences.userId, f.user.id)),
    ).toHaveLength(0);
  });
  it("preserves matched history and requires reversal before changing its effective dates", async () => {
    const f = await fixture();
    const matched = await f.service.manageFinanceOccurrenceMatch(f.match, f.context);
    const successor = {
      ...f.costInput,
      expectedSourceRevision: 2,
      supersedesId: f.cost.data.id,
      effectiveFrom: "2026-03-01",
      anchorLocalDate: "2026-03-02",
      idempotencyKey: randomUUID(),
    };
    await expect(
      f.service.confirmFinanceRecurringSchedule(successor, f.context),
    ).rejects.toMatchObject({ code: "conflict" });
    await f.service.manageFinanceOccurrenceMatch(
      {
        operation: "reverse",
        matchId: matched.data.id,
        rationale: "Reverse before date correction",
        idempotencyKey: randomUUID(),
      },
      f.context,
    );
    await f.service.confirmFinanceRecurringSchedule(
      { ...successor, idempotencyKey: randomUUID() },
      f.context,
    );
    const view = await f.service.listFinanceRecurringOccurrences(f.user.id, {
      from: "2026-03-01",
      to: "2026-03-02",
    });
    expect(view.occurrences.find((row) => row.localDate === "2026-03-01")).toMatchObject({
      inCurrentSchedule: false,
      remainingExpectedCents: 0,
    });
    expect(view.occurrences.find((row) => row.localDate === "2026-03-02")).toMatchObject({
      inCurrentSchedule: true,
    });
  });
  it("returns current source revisions, accepts an explicit balance reflection and never double-counts matched cash", async () => {
    const f = await fixture();
    await f.service.manageFinanceOccurrenceMatch(f.match, f.context);
    const sources = await f.service.listFinanceCashflowSources(f.user.id, {
      from: "2026-03-01",
      to: "2026-03-31",
    });
    expect(sources.accounts[0]?.accountRevision).toBe(f.account.contextualRevision.toString());
    expect(sources.income[0]?.revision).toBe(2);
    expect(sources.transactions[0]?.allocations[0]?.revision).toBe(f.allocation.revision);
    await f.service.confirmFinanceBalanceBasis(
      {
        accountId: f.account.id,
        kind: "current",
        amountCents: 100000,
        currencyCode: "USD",
        asOf: now().toISOString(),
        validUntil: "2026-04-01T00:00:00Z",
        protectedFloorCents: 0,
        expectedAccountRevision: f.account.contextualRevision.toString(),
        expectedBasisRevision: 0,
        reflections: [
          {
            transactionId: f.actual.id,
            transactionRevision: f.actual.contextualRevision.toString(),
            reimbursementRelationshipRevision:
              f.actual.reimbursementRelationshipRevision.toString(),
            reflection: "included",
          },
        ],
        idempotencyKey: randomUUID(),
      },
      f.context,
    );
    const view = await f.service.getFinanceCashflowProjection(f.user.id, {
      from: "2026-03-01",
      to: "2026-03-31",
      selectedIncomeStreamId: f.income.id,
    });
    expect(view.projection).toMatchObject({ status: "estimated", endingBalanceMinorUnits: 360000 });
    await database.db.insert(financeTransactions).values({
      userId: f.user.id,
      accountId: f.account.id,
      merchant: "New unknown reflection",
      amount: 100,
      currencyCode: "USD",
      direction: "expense",
      transactionDate: "2026-02-28",
      category: "Rent",
    });
    expect(
      (
        await f.service.getFinanceCashflowProjection(f.user.id, {
          from: "2026-03-01",
          to: "2026-03-31",
          selectedIncomeStreamId: f.income.id,
        })
      ).projection,
    ).toMatchObject({ status: "unavailable" });
  });
  it("invalidates a match when its actual revision changes rather than settling by amount similarity", async () => {
    const f = await fixture();
    await f.service.manageFinanceOccurrenceMatch(f.match, f.context);
    await database.db
      .update(financeTransactions)
      .set({ amount: 12000 })
      .where(eq(financeTransactions.id, f.actual.id));
    expect(
      (
        await f.service.listFinanceRecurringOccurrences(f.user.id, {
          from: "2026-03-01",
          to: "2026-03-01",
        })
      ).occurrences[0]?.matchState,
    ).toBe("invalidated");
  });
  it("links posted income directly without creating an allocation ledger", async () => {
    const f = await fixture();
    const [actual] = await database.db
      .insert(financeTransactions)
      .values({
        userId: f.user.id,
        accountId: f.account.id,
        merchant: "Synthetic salary",
        amount: 300000,
        currencyCode: "USD",
        direction: "income",
        transactionDate: "2026-03-31",
        category: "Salary",
        categorySource: "user",
      })
      .returning();
    if (!actual) throw new Error("Missing income actual");
    const expected = (
      await f.service.listFinanceRecurringOccurrences(f.user.id, {
        from: "2026-03-31",
        to: "2026-03-31",
      })
    ).occurrences.find((row) => row.source.kind === "income");
    if (!expected) throw new Error("Missing income occurrence");
    const matched = await f.service.manageFinanceOccurrenceMatch(
      {
        operation: "match_income",
        occurrence: {
          scheduleVersionId: expected.scheduleVersionId,
          localDate: expected.localDate,
          slot: expected.slot,
        },
        transactionId: actual.id,
        expectedTransactionRevision: actual.contextualRevision.toString(),
        expectedReimbursementRelationshipRevision:
          actual.reimbursementRelationshipRevision.toString(),
        amountCents: 300000,
        currencyCode: "USD",
        rationale: "Explicit salary actual",
        idempotencyKey: randomUUID(),
      },
      f.context,
    );
    expect(matched.data).toMatchObject({ incomeTransactionId: actual.id, allocationId: null });
    expect(
      await database.db
        .select()
        .from(financeTransactionAllocations)
        .where(eq(financeTransactionAllocations.transactionId, actual.id)),
    ).toHaveLength(0);
  });
});
