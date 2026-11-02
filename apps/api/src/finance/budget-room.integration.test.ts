import { resolve } from "node:path";
import {
  createDatabaseClient,
  financeAccounts,
  financeBudgetAllocations,
  financeBudgetBaselineQualifications,
  financeBudgetPlans,
  financeBudgetVersions,
  financeCategories,
  financeEconomicEvents,
  financeReimbursementMatches,
  financeReimbursements,
  financeTransactionAllocations,
  financeTransactionRelationships,
  financeRecurringObligations,
  financeTransactionCoverage,
  financeTransactions,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { readCashflowActuals } from "./balance-basis-service.js";
import { createFinanceBudgetBaselineQualificationService } from "./baseline-qualification-service.js";
import { readFinanceBudgetRoom } from "./budget-room-service.js";
import { loadFinanceAuthorization } from "./context.js";
import { createFinancePositionService } from "./position-service.js";
import { createProfileBudgetService } from "./profile-budget-service.js";
import { readScopedFinanceLedger, requireScopedLedgerScope } from "./scoped-ledger-reader.js";

const now = new Date("2026-11-02T16:00:00Z");
function required<T>(value: T | undefined): T {
  if (!value) throw new Error("Missing room fixture");
  return value;
}
describe.sequential("Canonical budget status category room", () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabaseClient>;
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine")
      .withLabels({ "nohmi.test.owner": "finance-scoped-room" })
      .start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve("packages/database/migrations"));
  }, 120_000);
  afterAll(async () => {
    await database.close();
    await container.stop();
  });
  async function fixture(month = "2026-11") {
    const owner = required(
      (
        await database.db
          .insert(users)
          .values({
            displayName: "Room owner",
            email: `${crypto.randomUUID()}@example.com`,
            passwordHash: "unused",
            planningTimezone: "America/New_York",
          })
          .returning()
      )[0],
    );
    const category = required(
      (
        await database.db
          .insert(financeCategories)
          .values({ userId: owner.id, name: "Food", slug: "food", group: "living" })
          .returning()
      )[0],
    );
    const plan = required(
      (
        await database.db
          .insert(financeBudgetPlans)
          .values({ userId: owner.id, name: "Monthly" })
          .returning()
      )[0],
    );
    const budget = required(
      (
        await database.db
          .insert(financeBudgetVersions)
          .values({
            userId: owner.id,
            planId: plan.id,
            version: 1,
            effectiveFrom: month,
            status: "active",
            approvedAt: new Date(`${month}-01T12:00:00Z`),
            approvedByActorType: "user",
            approvedByActorId: owner.id,
            expectedResources: 10000,
            allocatedTotal: 10000,
            balanceDelta: 0,
            resources: [{ key: "income", kind: "income", amount: 10000 }],
            rationale: "Synthetic approved budget",
          })
          .returning()
      )[0],
    );
    await database.db.insert(financeBudgetAllocations).values({
      userId: owner.id,
      budgetVersionId: budget.id,
      allocationKey: "food",
      kind: "spending",
      categoryId: category.id,
      amount: 10000,
    });
    return { owner, budget, category };
  }
  async function qualifiedFixture() {
    const f = await fixture();
    const account = required(
      (
        await database.db
          .insert(financeAccounts)
          .values({
            userId: f.owner.id,
            provider: "manual",
            name: "Cash",
            institution: "Synthetic",
            kind: "cash",
            balance: 20000,
            currencyCode: "USD",
            ownershipType: "individual",
            ownershipShareBps: 10000,
            syncState: "current",
          })
          .returning()
      )[0],
    );
    const context = await loadFinanceAuthorization({
      db: database.db,
      principal: {
        actorId: f.owner.id,
        actorType: "user",
        userId: f.owner.id,
        scopes: new Set(["finances:write"]),
      },
      requestId: "room-fixture",
    });
    const qualifier = createFinanceBudgetBaselineQualificationService({
      db: database.db,
      now: () => now,
    });
    const review = await qualifier.prepare(
      {
        budgetVersionId: f.budget.id,
        accountIds: [account.id],
        month: "2026-11",
        timezone: "America/New_York",
        currency: "USD",
        idempotencyKey: crypto.randomUUID(),
      },
      context,
    );
    await qualifier.confirm(
      {
        reviewId: review.id,
        expectedFingerprint: review.fingerprint,
        idempotencyKey: crypto.randomUUID(),
      },
      context,
    );
    const service = createProfileBudgetService({ db: database.db, now: () => now });
    const status = await service.getFinanceBudgetStatus(f.owner.id);
    if (!status.data) throw new Error("Missing current budget");
    return { ...f, account, qualifier, status, data: status.data };
  }
  type RoomFixture = Awaited<ReturnType<typeof qualifiedFixture>>;
  async function transaction(
    f: RoomFixture,
    changes: Partial<typeof financeTransactions.$inferInsert> = {},
  ) {
    return required(
      (
        await database.db
          .insert(financeTransactions)
          .values({
            userId: f.owner.id,
            accountId: f.account.id,
            categoryId: f.category.id,
            amount: 1000,
            direction: "expense",
            providerDirection: "expense",
            currencyCode: "USD",
            merchant: "Synthetic scoped movement",
            transactionDate: "2026-11-01",
            ...changes,
          })
          .returning()
      )[0],
    );
  }
  const scopeFor = (f: RoomFixture) => ({
    from: "2026-11-01",
    through: "2026-11-02",
    accountIds: [f.account.id],
  });
  const readRoom = (f: RoomFixture) =>
    database.db.transaction((tx) =>
      readFinanceBudgetRoom({
        db: database.db,
        tx,
        userId: f.owner.id,
        asOf: now,
        context: f.status.planContext,
        budget: f.data,
      }),
    );
  const readLedger = (f: RoomFixture) =>
    database.db.transaction((tx) => readScopedFinanceLedger(tx, f.owner.id, scopeFor(f)));
  const provenance = (userId: string) => ({
    actorId: userId,
    actorType: "user",
    confidence: null,
    evidence: {},
    maintenanceRunId: null,
    observedAt: now.toISOString(),
    requestId: null,
    sourceId: null,
  });
  async function relationship(
    f: RoomFixture,
    transactionIds: string[],
    kind: "reimbursement" | "refund" | "duplicate" | "split" = "reimbursement",
  ) {
    const event = required(
      (
        await database.db
          .insert(financeEconomicEvents)
          .values({
            userId: f.owner.id,
            kind,
            stableKey: crypto.randomUUID(),
          })
          .returning()
      )[0],
    );
    const row = required(
      (
        await database.db
          .insert(financeTransactionRelationships)
          .values({
            userId: f.owner.id,
            economicEventId: event.id,
            transactionIds,
            relationship: kind,
            rationale: "Synthetic owned graph",
            provenance: provenance(f.owner.id),
            createdAt: new Date(now.getTime() - 1000),
          })
          .returning()
      )[0],
    );
    return { event, row };
  }
  it("keeps an approved budget while explicitly withholding unsupported usable category room", async () => {
    const f = await fixture();
    const service = createProfileBudgetService({ db: database.db, now: () => now });
    const value = await service.getFinanceBudgetStatus(f.owner.id);
    expect(value.data).toMatchObject({ id: f.budget.id, status: "active", version: 1 });
    expect(value.planContext.state).toBe("approved");
    expect(value.communication.requiredDisclosures).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining("Usable category room is unavailable"),
      }),
    );
  });
  it("uses the caller's uncommitted ledger, coverage and schedule state without another snapshot", async () => {
    const f = await qualifiedFixture();
    const read = (tx: Parameters<Parameters<typeof database.db.transaction>[0]>[0]) =>
      readFinanceBudgetRoom({
        db: database.db,
        tx,
        userId: f.owner.id,
        asOf: now,
        context: f.status.planContext,
        budget: f.data,
      });
    let afterRevision = "";
    await expect(
      database.db.transaction(async (tx) => {
        const before = await read(tx);
        await tx.insert(financeTransactions).values({
          userId: f.owner.id,
          accountId: f.account.id,
          categoryId: f.category.id,
          amount: 1000,
          direction: "expense",
          providerDirection: "expense",
          currencyCode: "USD",
          merchant: "Synthetic",
          transactionDate: "2026-11-01",
        });
        await tx.insert(financeTransactionCoverage).values({
          userId: f.owner.id,
          accountId: f.account.id,
          fromDate: "2026-11-01",
          throughDate: "2026-11-02",
          timezone: "America/New_York",
          currencyCode: "USD",
          evidenceRef: "synthetic-statement",
          recordedAt: now,
        });
        await tx.insert(financeRecurringObligations).values({
          userId: f.owner.id,
          accountId: f.account.id,
          merchant: "Synthetic bill",
          displayName: "Unconfirmed bill",
          kind: "bill",
          expectedAmount: 2000,
          amountTolerance: 0,
          confidence: 10000,
          source: "user",
          cadence: "monthly",
          status: "active",
        });
        const after = await read(tx);
        expect(after.categories).toMatchObject([
          { observedCents: 1000, observedRemainingCents: 9000, estimatedUsableCents: null },
        ]);
        expect(after.reasons).toEqual(
          expect.arrayContaining([
            "obligation_completeness_unknown",
            "protection_unknown",
            "payday:unconfirmed_schedule",
          ]),
        );
        expect(after.reasons).not.toContain("transaction_history_incomplete");
        const scoped = await readScopedFinanceLedger(tx, f.owner.id, {
          from: "2026-11-01",
          through: "2026-11-02",
          accountIds: [f.account.id],
        });
        if (scoped.state !== "complete") throw new Error("Missing scoped evidence");
        const position = await createFinancePositionService({
          db: database.db,
          now: () => now,
        }).readPosition(
          f.owner.id,
          { from: "2026-11-01", through: "2026-11-02", accountIds: [f.account.id] },
          tx,
          scoped.ledger,
        );
        expect(after.sources.positionRevision).toBe(position.revision);
        expect(after.sources.positionRevision).not.toBe(before.sources.positionRevision);
        expect(after.revision).not.toBe(before.revision);
        afterRevision = after.revision;
        throw new Error("rollback room fixture");
      }),
    ).rejects.toThrow("rollback room fixture");
    const persisted = await database.db.transaction(read);
    expect(persisted.categories[0]?.observedCents).toBe(0);
    expect(persisted.revision).not.toBe(afterRevision);
  });
  it("reads qualification in the same caller transaction and restores it after rollback", async () => {
    const f = await qualifiedFixture();
    await expect(
      database.db.transaction(async (tx) => {
        await tx
          .delete(financeBudgetBaselineQualifications)
          .where(eq(financeBudgetBaselineQualifications.userId, f.owner.id));
        const value = await readFinanceBudgetRoom({
          db: database.db,
          tx,
          userId: f.owner.id,
          asOf: now,
          context: f.status.planContext,
          budget: f.data,
        });
        expect(value.reasons).toContain("budget_scope_unqualified");
        expect(value.categories[0]?.observedCents).toBeNull();
        throw new Error("rollback qualification fixture");
      }),
    ).rejects.toThrow("rollback qualification fixture");
    expect((await f.qualifier.getQualification(f.owner.id, "2026-11")).state).toBe("qualified");
  });
  it("rejects another owner's budget before loading or publishing any category facts", async () => {
    const f = await qualifiedFixture();
    const other = await fixture();
    await expect(
      database.db.transaction((tx) =>
        readFinanceBudgetRoom({
          db: database.db,
          tx,
          userId: other.owner.id,
          asOf: now,
          context: f.status.planContext,
          budget: f.data,
        }),
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });
  it("retains approved October history without using it as November category room", async () => {
    const f = await fixture("2026-10");
    const value = await createProfileBudgetService({
      db: database.db,
      now: () => now,
    }).getFinanceBudgetStatus(f.owner.id);
    expect(value.data).toBeNull();
    expect(value.planContext.previous?.id).toBe(f.budget.id);
    expect(value.communication.optionalDetails).toEqual([]);
  });

  it("rejects a stale budget revision instead of reusing room from the earlier version", async () => {
    const f = await qualifiedFixture();
    await expect(
      database.db.transaction(async (tx) => {
        await tx
          .update(financeBudgetVersions)
          .set({ version: 2 })
          .where(eq(financeBudgetVersions.id, f.budget.id));
        await readFinanceBudgetRoom({
          db: database.db,
          tx,
          userId: f.owner.id,
          asOf: now,
          context: f.status.planContext,
          budget: f.data,
        });
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("withholds a qualified scope when its account no longer belongs to the owner", async () => {
    const f = await qualifiedFixture();
    const other = await fixture();
    await expect(
      database.db.transaction(async (tx) => {
        await tx
          .update(financeAccounts)
          .set({ userId: other.owner.id })
          .where(eq(financeAccounts.id, f.account.id));
        const room = await readFinanceBudgetRoom({
          db: database.db,
          tx,
          userId: f.owner.id,
          asOf: now,
          context: f.status.planContext,
          budget: f.data,
        });
        expect(room.reasons).toContain("budget_scope_unqualified");
        expect(room.categories[0]?.observedCents).toBeNull();
        throw new Error("rollback account fixture");
      }),
    ).rejects.toThrow("rollback account fixture");
  });
  it("keeps current observed room when unrelated lifetime transactions exceed the read bound", async () => {
    const f = await qualifiedFixture();
    await database.db.insert(financeTransactions).values([
      ...Array.from({ length: 1001 }, (_, index) => ({
        userId: f.owner.id,
        accountId: f.account.id,
        categoryId: f.category.id,
        amount: 1,
        direction: "expense" as const,
        providerDirection: "expense" as const,
        currencyCode: "USD",
        merchant: `Unrelated history ${index}`,
        transactionDate: "2020-01-01",
      })),
      {
        userId: f.owner.id,
        accountId: f.account.id,
        categoryId: f.category.id,
        amount: 1000,
        direction: "expense",
        providerDirection: "expense",
        currencyCode: "USD",
        merchant: "Current food",
        transactionDate: "2026-11-01",
      },
    ]);
    await database.db.insert(financeTransactionCoverage).values({
      userId: f.owner.id,
      accountId: f.account.id,
      fromDate: "2026-11-01",
      throughDate: "2026-11-02",
      timezone: "America/New_York",
      currencyCode: "USD",
      evidenceRef: "synthetic-current-statement",
      recordedAt: now,
    });
    const room = await database.db.transaction((tx) =>
      readFinanceBudgetRoom({
        db: database.db,
        tx,
        userId: f.owner.id,
        asOf: now,
        context: f.status.planContext,
        budget: f.data,
      }),
    );
    expect(room.reasons).not.toContain("ledger_bound_exceeded");
    expect(room.categories).toMatchObject([
      { observedCents: 1000, observedRemainingCents: 9000, estimatedUsableCents: null },
    ]);
    expect(room.reasons).toContain("obligation_completeness_unknown");
  });
  it("loads refund and supersession edges outside the selected account and period", async () => {
    const f = await qualifiedFixture();
    const otherAccount = required(
      (
        await database.db
          .insert(financeAccounts)
          .values({
            userId: f.owner.id,
            provider: "manual",
            name: "Other cash",
            institution: "Synthetic",
            kind: "cash",
            currencyCode: "USD",
            ownershipType: "individual",
            ownershipShareBps: 10000,
          })
          .returning()
      )[0],
    );
    const purchase = await transaction(f, {
      accountId: otherAccount.id,
      transactionDate: "2026-10-01",
    });
    const refund = await transaction(f, {
      amount: 200,
      direction: "income",
      providerDirection: "income",
    });
    const linked = await relationship(f, [purchase.id, refund.id], "refund");
    const before = await readLedger(f);
    expect(before).toMatchObject({
      state: "complete",
      ledger: {
        transactions: expect.arrayContaining([
          expect.objectContaining({ id: purchase.id }),
          expect.objectContaining({ id: refund.id }),
        ]),
        accounts: expect.arrayContaining([expect.objectContaining({ id: otherAccount.id })]),
      },
    });
    expect((await readRoom(f)).categories[0]?.observedCents).toBe(-200);
    const replacement = await transaction(f, { transactionDate: "2026-09-01" });
    await database.db.insert(financeTransactionRelationships).values({
      userId: f.owner.id,
      economicEventId: linked.event.id,
      relationship: "duplicate",
      transactionIds: [purchase.id, replacement.id],
      rationale: "Synthetic superseding evidence",
      provenance: provenance(f.owner.id),
      createdAt: now,
    });
    const after = await readLedger(f);
    expect(after).toMatchObject({
      state: "complete",
      ledger: {
        relationships: expect.arrayContaining([
          expect.objectContaining({ id: linked.row.id }),
          expect.objectContaining({ transactionIds: [purchase.id, replacement.id] }),
        ]),
      },
    });
    expect((await readRoom(f)).categories[0]?.observedCents).toBe(0);
    if (before.state !== "complete" || after.state !== "complete")
      throw new Error("Missing closed graph");
    expect(after.ledger.revision).not.toBe(before.ledger.revision);
  });
  it("follows reimbursement matches backwards from a selected credit to its historical allocation", async () => {
    const f = await qualifiedFixture();
    const purchase = await transaction(f, { transactionDate: "2026-10-01" });
    const credit = await transaction(f, {
      amount: 500,
      direction: "income",
      providerDirection: "income",
      category: "INCOME",
    });
    const allocation = required(
      (
        await database.db
          .insert(financeTransactionAllocations)
          .values({
            userId: f.owner.id,
            transactionId: purchase.id,
            categoryId: f.category.id,
            amount: 1000,
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
            userId: f.owner.id,
            allocationId: allocation.id,
            expectedAmount: 500,
            receivedAmount: 500,
            status: "received",
            rationale: "Synthetic paid claim",
          })
          .returning()
      )[0],
    );
    await database.db.insert(financeReimbursementMatches).values({
      userId: f.owner.id,
      reimbursementId: claim.id,
      creditTransactionId: credit.id,
      amount: 500,
      rationale: "Synthetic credit",
    });
    const closed = await readLedger(f);
    expect(closed).toMatchObject({
      state: "complete",
      ledger: {
        allocations: [expect.objectContaining({ id: allocation.id })],
        reimbursements: [expect.objectContaining({ id: claim.id })],
        transactions: expect.arrayContaining([expect.objectContaining({ id: purchase.id })]),
      },
    });
    const actuals = await database.db.transaction((tx) =>
      readCashflowActuals(
        tx,
        f.owner.id,
        {
          from: "2026-11-01",
          to: "2026-11-02",
          accountIds: [f.account.id],
        },
        true,
      ),
    );
    expect(actuals.truncated).toBe(false);
    expect(actuals.eligibility(credit, "income").reasons).toContain(
      "reimbursement_or_refund_credit",
    );
  });
  it("includes pending replacements and reconciled group peers outside the month", async () => {
    const f = await qualifiedFixture();
    const pendingId = `pending-${crypto.randomUUID()}`;
    const pending = await transaction(f, { pending: true, providerTransactionId: pendingId });
    const posted = await transaction(f, {
      pendingTransactionId: pendingId,
      providerTransactionId: `posted-${crypto.randomUUID()}`,
      transactionDate: "2026-10-31",
    });
    const group = crypto.randomUUID();
    const transfer = await transaction(f, {
      transferGroupId: group,
      direction: "transfer",
      reconciliationStatus: "confirmed",
    });
    const peer = await transaction(f, {
      transferGroupId: group,
      direction: "transfer",
      providerDirection: "income",
      reconciliationStatus: "confirmed",
      transactionDate: "2026-10-31",
    });
    const closed = await readLedger(f);
    expect(closed).toMatchObject({
      state: "complete",
      ledger: {
        transactions: expect.arrayContaining([
          expect.objectContaining({ id: pending.id }),
          expect.objectContaining({ id: posted.id }),
          expect.objectContaining({ id: transfer.id }),
          expect.objectContaining({ id: peer.id }),
        ]),
      },
    });
    expect((await readRoom(f)).categories[0]?.observedCents).toBe(0);
  });
  it.each([
    "missing",
    "foreign",
    "malformed",
    "foreign_event",
    "malformed_provenance",
  ] as const)("withholds a closure with %s required evidence", async (kind) => {
    const f = await qualifiedFixture();
    const selected = await transaction(f);
    const other = await qualifiedFixture();
    const foreign = await transaction(other);
    const target =
      kind === "foreign" ? foreign.id : kind === "malformed" ? "not-a-uuid" : crypto.randomUUID();
    const linked = await relationship(
      f,
      ["foreign_event", "malformed_provenance"].includes(kind)
        ? [selected.id]
        : [selected.id, target],
    );
    if (kind === "malformed_provenance")
      await database.db
        .update(financeTransactionRelationships)
        .set({ provenance: {} })
        .where(eq(financeTransactionRelationships.id, linked.row.id));
    if (kind === "foreign_event")
      await database.db
        .update(financeEconomicEvents)
        .set({ userId: other.owner.id })
        .where(eq(financeEconomicEvents.id, linked.event.id));
    expect(await readLedger(f)).toMatchObject({
      state: "unavailable",
      reason: "ledger_evidence_incomplete",
    });
    const room = await readRoom(f);
    expect(room.reasons).toContain("ledger_evidence_incomplete");
    expect(room.categories[0]?.observedCents).toBeNull();
  });
  it("ignores foreign-owner edges without disclosing their records", async () => {
    const f = await qualifiedFixture();
    const selected = await transaction(f);
    const other = await qualifiedFixture();
    const foreign = await transaction(other);
    await relationship(other, [selected.id, foreign.id], "duplicate");
    const closed = await readLedger(f);
    expect(closed).toMatchObject({
      state: "complete",
      ledger: {
        transactions: [expect.objectContaining({ id: selected.id, userId: f.owner.id })],
        relationships: [],
      },
    });
    expect((await readRoom(f)).categories[0]?.observedCents).toBe(1000);
  });
  it("refuses actual dependency expansion beyond the bound even when period seeds fit", async () => {
    const f = await qualifiedFixture();
    const selected = await transaction(f);
    const old = await database.db
      .insert(financeTransactions)
      .values(
        Array.from({ length: 1000 }, () => ({
          userId: f.owner.id,
          accountId: f.account.id,
          categoryId: f.category.id,
          amount: 1,
          direction: "expense" as const,
          providerDirection: "expense" as const,
          currencyCode: "USD",
          merchant: "Linked historical evidence",
          transactionDate: "2020-01-01",
        })),
      )
      .returning();
    await relationship(f, [selected.id, ...old.map((row) => row.id)], "split");
    expect(await readLedger(f)).toEqual({ state: "unavailable", reason: "ledger_bound_exceeded" });
    expect((await readRoom(f)).reasons).toContain("ledger_bound_exceeded");
  });
  it("keeps historical funding actuals unavailable instead of dropping them at the room boundary", async () => {
    const f = await qualifiedFixture();
    await database.db.insert(financeTransactions).values(
      Array.from({ length: 1001 }, () => ({
        userId: f.owner.id,
        accountId: f.account.id,
        categoryId: f.category.id,
        amount: 1,
        direction: "expense" as const,
        providerDirection: "expense" as const,
        currencyCode: "USD",
        merchant: "Historical funding actual",
        transactionDate: "2020-01-01",
      })),
    );
    const actuals = await database.db.transaction((tx) =>
      readCashflowActuals(
        tx,
        f.owner.id,
        {
          from: "0001-01-01",
          to: "9999-12-31",
          accountIds: [f.account.id],
        },
        true,
      ),
    );
    expect(actuals.truncated).toBe(true);
    expect(actuals.transactions).toEqual([]);
    expect((await readRoom(f)).categories[0]?.estimatedUsableCents).toBeNull();
  });
  it("uses local posting days and invalidates only relevant native ledger revisions", async () => {
    const f = await qualifiedFixture();
    const relevant = await transaction(f, { transactionDate: "2026-11-03T02:00:00Z" });
    await database.db
      .update(financeAccounts)
      .set({ lastSyncedAt: now, syncState: "current" })
      .where(eq(financeAccounts.id, f.account.id));
    const before = await readRoom(f);
    expect(before.reasons).not.toContain("source_not_current");
    expect(before.categories[0]?.observedCents).toBe(1000);
    await transaction(f, { transactionDate: "2020-01-01" });
    expect((await readRoom(f)).revision).toBe(before.revision);
    await database.db
      .update(financeTransactions)
      .set({ contextualRevision: 2n })
      .where(eq(financeTransactions.id, relevant.id));
    expect((await readRoom(f)).revision).not.toBe(before.revision);
    await database.db
      .update(financeAccounts)
      .set({ syncState: "blocked" })
      .where(eq(financeAccounts.id, f.account.id));
    const stale = await readRoom(f);
    expect(stale.reasons).toContain("source_not_current");
    expect(stale.categories[0]?.estimatedUsableCents).toBeNull();
  });
  it("rejects a private snapshot reused for a foreign owner or different scope", async () => {
    const f = await qualifiedFixture();
    const closed = await readLedger(f);
    if (closed.state !== "complete") throw new Error("Missing closed graph");
    expect(() => requireScopedLedgerScope(closed.ledger, crypto.randomUUID(), scopeFor(f))).toThrow(
      "does not match",
    );
    expect(() =>
      requireScopedLedgerScope(closed.ledger, f.owner.id, {
        ...scopeFor(f),
        through: "2026-11-03",
      }),
    ).toThrow("does not match");
    expect(() =>
      requireScopedLedgerScope(closed.ledger, f.owner.id, { ...scopeFor(f), from: "2026-10-01" }),
    ).toThrow("does not match");
    expect(() =>
      requireScopedLedgerScope(closed.ledger, f.owner.id, { ...scopeFor(f), accountIds: [] }),
    ).toThrow("does not match");
    const none = await database.db.transaction((tx) =>
      readScopedFinanceLedger(tx, f.owner.id, { ...scopeFor(f), accountIds: [] }),
    );
    expect(none).toMatchObject({ state: "complete", ledger: { transactions: [], accounts: [] } });
  });
  it.each([
    "transactions",
    "categories",
  ] as const)("refuses an oversized owner snapshot of %s before loading complete ledger projections", async (kind) => {
    const f = await qualifiedFixture();
    if (kind === "transactions") {
      await database.db.insert(financeTransactions).values(
        Array.from({ length: 1001 }, (_, index) => ({
          userId: f.owner.id,
          accountId: f.account.id,
          categoryId: f.category.id,
          amount: 1,
          direction: "expense" as const,
          providerDirection: "expense" as const,
          currencyCode: "USD",
          merchant: `Synthetic${index}`,
          transactionDate: "2026-11-01",
        })),
      );
    } else {
      await database.db.insert(financeCategories).values(
        Array.from({ length: 1000 }, (_, index) => ({
          userId: f.owner.id,
          name: `Category${index}`,
          slug: `category-${index}`,
          group: "living",
        })),
      );
    }
    const room = await database.db.transaction((tx) =>
      readFinanceBudgetRoom({
        db: database.db,
        tx,
        userId: f.owner.id,
        asOf: now,
        context: f.status.planContext,
        budget: f.data,
      }),
    );
    expect(room.sources.positionRevision).toBeNull();
    expect(room.reasons).toContain("ledger_bound_exceeded");
    expect(room.categories[0]?.observedCents).toBeNull();
  });
});
