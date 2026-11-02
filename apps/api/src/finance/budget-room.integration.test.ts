import { resolve } from "node:path";
import {
  createDatabaseClient,
  financeAccounts,
  financeBudgetAllocations,
  financeBudgetBaselineQualifications,
  financeBudgetPlans,
  financeBudgetVersions,
  financeCategories,
  financeRecurringObligations,
  financeTransactionCoverage,
  financeTransactions,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { createFinanceBudgetBaselineQualificationService } from "./baseline-qualification-service.js";
import { readFinanceBudgetRoom } from "./budget-room-service.js";
import { loadFinanceAuthorization } from "./context.js";
import { createFinancePositionService } from "./position-service.js";
import { createProfileBudgetService } from "./profile-budget-service.js";

const now = new Date("2026-11-02T16:00:00Z");
function required<T>(value: T | undefined): T {
  if (!value) throw new Error("Missing room fixture");
  return value;
}
describe.sequential("Canonical budget status category room", () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabaseClient>;
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
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
        const position = await createFinancePositionService({
          db: database.db,
          now: () => now,
        }).readPosition(
          f.owner.id,
          { from: "2026-11-01", through: "2026-11-02", accountIds: [f.account.id] },
          tx,
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
