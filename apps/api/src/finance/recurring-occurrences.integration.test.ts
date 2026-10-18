import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  financeAccounts,
  financeCategories,
  financeIncomeStreams,
  financeOccurrenceMatchEvents,
  financeRecurringObligations,
  financeRecurringOccurrences,
  financeTransactionAllocations,
  financeTransactions,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, sql } from "drizzle-orm";
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
    const sources = await f.service.listFinanceBalanceBasisSources(f.user.id, { accountIds: [f.account.id] });
    expect(sources.coverage).toMatchObject({ complete: true, truncated: false });
    return f.service.confirmFinanceBalanceBasis({ accountId: f.account.id, kind: "current", amountCents: 100000, currencyCode: "USD", asOf: now().toISOString(), validUntil: "2026-05-01T00:00:00Z", protectedFloorCents: 0, expectedAccountRevision: f.account.contextualRevision.toString(), expectedBasisRevision: 0, reflections: sources.transactions.map(row => ({ transactionId: row.id, transactionRevision: row.transactionRevision, reflection: "included" as const })), idempotencyKey: randomUUID() }, f.context);
  }
  async function closePreviousPayday(f: Awaited<ReturnType<typeof fixture>>) {
    const [salary] = await database.db.insert(financeTransactions).values({ userId: f.user.id, accountId: f.account.id, merchant: "Synthetic salary", amount: 300000, currencyCode: "USD", direction: "income", transactionDate: "2026-02-28", category: "Income", categorySource: "user", categoryConfidence: 10000 }).returning();
    if (!salary) throw new Error("Missing synthetic salary");
    const schedule = await f.service.listFinanceRecurringOccurrences(f.user.id, { from: "2026-02-28", to: "2026-02-28" });
    const payday = schedule.occurrences.find(row => row.source.kind === "income");
    if (!payday) throw new Error("Missing previous payday");
    await f.service.manageFinanceOccurrenceMatch({ operation: "match_income", occurrence: { scheduleVersionId: payday.scheduleVersionId, localDate: payday.localDate, slot: payday.slot }, transactionId: salary.id, expectedTransactionRevision: salary.contextualRevision.toString(), amountCents: 300000, currencyCode: "USD", rationale: "Explicit previous salary", idempotencyKey: randomUUID() }, f.context);
  }

  it("reviews historical current revisions separately and refuses an incomplete balance statement", async () => {
    const f = await fixture();
    const [old] = await database.db.insert(financeTransactions).values({ userId: f.user.id, accountId: f.account.id, merchant: "Historical included expense", amount: 500, currencyCode: "USD", direction: "expense", transactionDate: "2025-01-01", category: "Rent", categorySource: "user" }).returning();
    const timeline = await f.service.listFinanceCashflowSources(f.user.id, { from: "2026-03-01", to: "2026-03-31" });
    expect(timeline.transactions.map(row => row.id)).not.toContain(old?.id);
    const review = await f.service.listFinanceBalanceBasisSources(f.user.id, { accountIds: [f.account.id] });
    expect(review.transactions.map(row => row.id)).toContain(old?.id);
    expect((await f.service.listFinanceBalanceBasisSources(f.user.id, { accountIds: [] })).transactions).toEqual([]);
    await expect(f.service.confirmFinanceBalanceBasis({ accountId: f.account.id, kind: "current", amountCents: 100000, currencyCode: "USD", asOf: now().toISOString(), validUntil: "2026-05-01T00:00:00Z", protectedFloorCents: 0, expectedAccountRevision: f.account.contextualRevision.toString(), expectedBasisRevision: 0, reflections: [{ transactionId: f.actual.id, transactionRevision: f.actual.contextualRevision.toString(), reflection: "included" }], idempotencyKey: randomUUID() }, f.context)).rejects.toMatchObject({ code: "conflict" });
    await f.service.manageFinanceOccurrenceMatch(f.match, f.context);
    await statement(f);
    const view = await f.service.getFinanceCashflowProjection(f.user.id, { from: "2026-03-01", to: "2026-04-30", selectedIncomeStreamId: f.income.id });
    expect(view.projection).toMatchObject({ status: "estimated", endingBalanceMinorUnits: 360000 });
  });

  it("shares one canonical allocation capacity across two occurrence matches without double cash", async () => {
    const f = await fixture();
    await f.service.manageFinanceOccurrenceMatch({ ...f.match, amountCents: 4000 }, f.context);
    await f.service.manageFinanceOccurrenceMatch({ ...f.match, occurrence: { ...f.match.occurrence, localDate: "2026-03-08" }, amountCents: 6000, idempotencyKey: randomUUID() }, f.context);
    await statement(f);
    expect((await f.service.getFinanceCashflowProjection(f.user.id, { from: "2026-03-01", to: "2026-04-30", selectedIncomeStreamId: f.income.id })).projection).toMatchObject({ status: "estimated", endingBalanceMinorUnits: 360000 });
  });

  it("preserves separate canonical allocation identities for multiple matches to one transaction", async () => {
    const f = await fixture();
    await database.db.update(financeTransactionAllocations).set({ state: "invalidated" }).where(eq(financeTransactionAllocations.id, f.allocation.id));
    const allocations = await database.db.insert(financeTransactionAllocations).values([4000, 6000].map((amount, allocationOrder) => ({ userId: f.user.id, transactionId: f.actual.id, categoryId: f.allocation.categoryId, amount, allocationOrder, treatment: "personal" as const }))).returning();
    for (const allocation of allocations) await f.service.manageFinanceOccurrenceMatch({ ...f.match, allocationId: allocation.id, expectedAllocationRevision: allocation.revision, amountCents: allocation.amount, idempotencyKey: randomUUID() }, f.context);
    await statement(f);
    expect((await f.service.getFinanceCashflowProjection(f.user.id, { from: "2026-03-01", to: "2026-04-30", selectedIncomeStreamId: f.income.id })).projection).toMatchObject({ status: "estimated", endingBalanceMinorUnits: 360000 });
  });

  it("uses today's next payday and excludes retired reversed variable history from a fixed successor forecast", async () => {
    const f = await fixture();
    const variable = await f.service.confirmFinanceRecurringSchedule({ ...f.costInput, expectedSourceRevision: 2, supersedesId: f.cost.data.id, effectiveFrom: "2026-02-15", anchorLocalDate: "2026-02-15", amountBasis: "variable", idempotencyKey: randomUUID() }, f.context);
    const match = await f.service.manageFinanceOccurrenceMatch({ ...f.match, occurrence: { scheduleVersionId: variable.data.id, localDate: "2026-02-22", slot: 0 } }, f.context);
    await f.service.manageFinanceOccurrenceMatch({ operation: "reverse", matchId: match.data.id, rationale: "Correct variable schedule", idempotencyKey: randomUUID() }, f.context);
    await f.service.confirmFinanceRecurringSchedule({ ...f.costInput, expectedSourceRevision: 3, supersedesId: variable.data.id, effectiveFrom: "2026-03-01", anchorLocalDate: "2026-03-01", idempotencyKey: randomUUID() }, f.context);
    await closePreviousPayday(f);
    await statement(f);
    const view = await f.service.getFinanceCashflowProjection(f.user.id, { from: "2026-02-22", to: "2026-04-30", selectedIncomeStreamId: f.income.id });
    expect(view.schedule.occurrences.some(row => row.scheduleVersionId === variable.data.id && row.amountBasis === "variable")).toBe(true);
    expect(view.schedule.matchEvents.some(row => row.kind === "reverse")).toBe(true);
    expect(view.projection).toMatchObject({ status: "estimated", endingBalanceMinorUnits: 350000 });
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
      .set({ amount: 12000, contextualRevision: sql`${financeTransactions.contextualRevision}+1` })
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
