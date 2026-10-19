import { resolve } from "node:path";
import {
  auditEvents,
  createDatabaseClient,
  financeAccounts,
  financeBudgetBaselineQualifications,
  financeBudgetVersions,
  financeCategories,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq } from "drizzle-orm";
import { createFinanceBudgetBaselineQualificationService } from "./baseline-qualification-service.js";
import { policyBaseline } from "./budget-policy-evidence.js";
import { createFinanceBudgetPolicyService } from "./budget-policy-service.js";
import { loadFinanceAuthorization } from "./context.js";
import { createProfileBudgetService } from "./profile-budget-service.js";

const now = new Date("2026-10-18T16:00:00Z");
describe.sequential("immutable monthly budget qualification", () => {
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
  async function fixture(zeroSpending = false) {
    const [owner] = await database.db
      .insert(users)
      .values({
        displayName: "Baseline owner",
        email: `${crypto.randomUUID()}@example.com`,
        passwordHash: "unused",
      })
      .returning();
    if (!owner) throw new Error("Missing owner.");
    const context = await loadFinanceAuthorization({
      db: database.db,
      principal: {
        actorId: owner.id,
        actorType: "user",
        userId: owner.id,
        scopes: new Set(["finances:write"]),
      },
      requestId: crypto.randomUUID(),
    });
    const [category] = await database.db
      .insert(financeCategories)
      .values({ userId: owner.id, name: "Food", slug: "food", group: "Essentials" })
      .returning();
    const [account] = await database.db
      .insert(financeAccounts)
      .values({
        userId: owner.id,
        name: "Budget cash",
        institution: "Fixture",
        provider: "manual",
        status: "manual",
        currencyCode: "USD",
      })
      .returning();
    if (!category || !account) throw new Error("Missing budget evidence.");
    const budgets = createProfileBudgetService({ db: database.db, now: () => now });
    const profile = await budgets.updateFinancialProfile(
      { changes: { householdSize: 1 }, expectedVersion: 0, idempotencyKey: crypto.randomUUID() },
      context,
    );
    const proposal = await budgets.createFinanceBudget(
      {
        name: "Monthly baseline",
        effectiveFrom: "2026-09",
        resources: [{ amount: 100, key: "income", kind: "income" }],
        allocations: [
          {
            amount: zeroSpending ? 0 : 100,
            key: "food",
            kind: "spending",
            categoryId: category.id,
          },
          ...(zeroSpending ? [{ amount: 100, key: "buffer", kind: "buffer" as const }] : []),
        ],
        assumptions: [],
        rationale: "Historical fixture baseline",
        idempotencyKey: crypto.randomUUID(),
      },
      context,
    );
    await budgets.approveFinanceBudget(
      {
        budgetVersionId: proposal.data.id,
        expectedVersion: proposal.data.version,
        expectedProfileVersionId: profile.data.id,
        approvalSource: "user_instruction",
        idempotencyKey: crypto.randomUUID(),
      },
      context,
    );
    const service = createFinanceBudgetBaselineQualificationService({
      db: database.db,
      now: () => now,
    });
    const input = {
      budgetVersionId: proposal.data.id,
      accountIds: [account.id],
      currency: "USD",
      month: "2026-09",
      timezone: "America/New_York",
      idempotencyKey: crypto.randomUUID(),
    };
    return { owner, context, category, account, service, input, proposal, profile };
  }
  it("qualifies an explicitly approved zero spending limit without replacing it with absence", async () => {
    const f = await fixture(true);
    const review = await f.service.prepare(f.input, f.context);
    expect(review.snapshot.allocations).toEqual([
      expect.objectContaining({ key: "food", categoryId: f.category.id, amountCents: 0 }),
    ]);
    await expect(
      f.service.confirm(
        {
          reviewId: review.id,
          expectedFingerprint: "0".repeat(64),
          idempotencyKey: crypto.randomUUID(),
        },
        f.context,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    const result = await f.service.confirm(
      {
        reviewId: review.id,
        expectedFingerprint: review.fingerprint,
        idempotencyKey: crypto.randomUUID(),
      },
      f.context,
    );
    expect(result).toMatchObject({
      state: "qualified",
      qualification: { allocations: review.snapshot.allocations, confirmedByActorId: f.owner.id },
    });
    expect(await f.service.getQualification(f.owner.id, f.input.month)).toEqual(result);
  });
  it("requires exact human confirmation, replays once and retains immutable historical identity and account scope", async () => {
    const f = await fixture();
    await expect(f.service.getQualification(f.owner.id, f.input.month)).resolves.toMatchObject({
      state: "unavailable",
      reason: "qualification_required",
    });
    const agent = {
      ...f.context,
      actorId: "agent",
      actorType: "agent" as const,
      bypassEnabled: true,
      canSelfApprove: true,
    };
    const review = await f.service.prepare(f.input, agent);
    const confirmation = {
      reviewId: review.id,
      expectedFingerprint: review.fingerprint,
      idempotencyKey: crypto.randomUUID(),
    };
    await expect(f.service.confirm(confirmation, agent)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      f.service.confirm(
        {
          ...confirmation,
          expectedFingerprint: "0".repeat(64),
          idempotencyKey: crypto.randomUUID(),
        },
        f.context,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    const result = await f.service.confirm(confirmation, f.context);
    expect(result).toMatchObject({
      state: "qualified",
      qualification: {
        accountIds: [f.account.id],
        currency: "USD",
        qualificationKind: "retrospective",
        allocations: [{ categoryId: f.category.id, label: "Food", amountCents: 10000 }],
        originalApproval: { actorType: "user" },
      },
    });
    expect(await f.service.confirm(confirmation, f.context)).toEqual(result);
    expect(
      await database.db.$count(
        auditEvents,
        and(
          eq(auditEvents.userId, f.owner.id),
          eq(auditEvents.action, "finance.budget_baseline_qualified"),
        ),
      ),
    ).toBe(1);
    await database.db
      .update(financeCategories)
      .set({ name: "Renamed" })
      .where(eq(financeCategories.id, f.category.id));
    await database.db.insert(financeAccounts).values({
      userId: f.owner.id,
      name: "Later account",
      institution: "Fixture",
      provider: "manual",
      currencyCode: "USD",
    });
    expect(await f.service.getQualification(f.owner.id, f.input.month)).toEqual(result);
    await database.db
      .update(financeAccounts)
      .set({ currencyCode: "EUR" })
      .where(eq(financeAccounts.id, f.account.id));
    // Later account facts do not relabel an explicitly confirmed historical currency.
    expect(await f.service.getQualification(f.owner.id, f.input.month)).toEqual(result);
    await expect(
      database.db
        .update(financeBudgetBaselineQualifications)
        .set({ snapshot: {} })
        .where(eq(financeBudgetBaselineQualifications.userId, f.owner.id)),
    ).rejects.toThrow();
    await database.db.delete(financeCategories).where(eq(financeCategories.id, f.category.id));
    expect(await f.service.getQualification(f.owner.id, f.input.month)).toEqual(result);
    await database.db.delete(financeAccounts).where(eq(financeAccounts.id, f.account.id));
    await expect(f.service.getQualification(f.owner.id, f.input.month)).resolves.toMatchObject({
      state: "unavailable",
      reason: "scope_unavailable",
    });
  });
  it("rejects stale source evidence, foreign accounts and incompatible currency without qualifying", async () => {
    const f = await fixture();
    const other = await fixture();
    await expect(
      f.service.prepare({ ...f.input, accountIds: [other.account.id] }, f.context),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      f.service.prepare(
        { ...f.input, currency: "EUR", idempotencyKey: crypto.randomUUID() },
        f.context,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    const review = await f.service.prepare(
      { ...f.input, idempotencyKey: crypto.randomUUID() },
      f.context,
    );
    await expect(
      f.service.confirm(
        {
          reviewId: review.id,
          expectedFingerprint: review.fingerprint,
          idempotencyKey: crypto.randomUUID(),
        },
        other.context,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    await database.db
      .update(financeCategories)
      .set({ updatedAt: new Date(now.getTime() + 1000) })
      .where(eq(financeCategories.id, f.category.id));
    await expect(
      f.service.confirm(
        {
          reviewId: review.id,
          expectedFingerprint: review.fingerprint,
          idempotencyKey: crypto.randomUUID(),
        },
        f.context,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(f.service.getQualification(f.owner.id, f.input.month)).resolves.toMatchObject({
      state: "unavailable",
    });
  });
  it("prevents a later policy baseline or currency from diverging from the confirmed comparison", async () => {
    const f = await fixture();
    const review = await f.service.prepare(f.input, f.context);
    await f.service.confirm(
      {
        reviewId: review.id,
        expectedFingerprint: review.fingerprint,
        idempotencyKey: crypto.randomUUID(),
      },
      f.context,
    );
    const policies = createFinanceBudgetPolicyService({ db: database.db, now: () => now });
    const period = { from: "2026-09-01", through: "2026-09-30", timezone: "America/New_York" };
    const budget = { id: f.proposal.data.id, revision: String(f.proposal.data.version) };
    const designation = {
      planId: f.proposal.data.planId,
      budget,
      period,
      expectedProfile: { id: f.profile.data.id, revision: String(f.profile.data.version) },
      expectedLatestBudget: budget,
      idempotencyKey: crypto.randomUUID(),
    };
    await expect(
      policies.designateBaseline(f.context, {
        ...designation,
        period: { ...period, timezone: "UTC" },
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      policies.designateBaseline(f.context, {
        ...designation,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).resolves.toMatchObject({ budget, period });
    expect(
      await database.db.transaction((tx) =>
        policyBaseline(tx, f.owner.id, f.proposal.data.planId, {
          baseline: budget,
          period,
          currency: "USD",
        }),
      ),
    ).toMatchObject({ id: budget.id });
  });

  it("never treats a separately confirmed historical currency as the policy's USD assumption", async () => {
    const f = await fixture();
    await database.db
      .update(financeAccounts)
      .set({ currencyCode: "EUR" })
      .where(eq(financeAccounts.id, f.account.id));
    const review = await f.service.prepare({ ...f.input, currency: "EUR" }, f.context);
    await f.service.confirm(
      {
        reviewId: review.id,
        expectedFingerprint: review.fingerprint,
        idempotencyKey: crypto.randomUUID(),
      },
      f.context,
    );
    const policies = createFinanceBudgetPolicyService({ db: database.db, now: () => now });
    const period = { from: "2026-09-01", through: "2026-09-30", timezone: "America/New_York" };
    const budget = { id: f.proposal.data.id, revision: String(f.proposal.data.version) };
    await policies.designateBaseline(f.context, {
      planId: f.proposal.data.planId,
      period,
      budget,
      expectedProfile: { id: f.profile.data.id, revision: String(f.profile.data.version) },
      expectedLatestBudget: budget,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(
      await database.db.transaction((tx) =>
        policyBaseline(tx, f.owner.id, f.proposal.data.planId, {
          baseline: budget,
          period,
          currency: "USD",
        }),
      ),
    ).toBeNull();
  });

  it("records later human confirmation without relabeling the original agent approval", async () => {
    const f = await fixture();
    await database.db
      .update(financeBudgetVersions)
      .set({ approvedByActorType: "agent", approvedByActorId: "historical-agent" })
      .where(eq(financeBudgetVersions.id, f.proposal.data.id));
    const review = await f.service.prepare(f.input, f.context);
    await expect(
      f.service.confirm(
        {
          reviewId: review.id,
          expectedFingerprint: review.fingerprint,
          idempotencyKey: crypto.randomUUID(),
        },
        f.context,
      ),
    ).resolves.toMatchObject({
      state: "qualified",
      qualification: {
        qualificationKind: "retrospective",
        confirmedByActorId: f.owner.id,
        originalApproval: { actorType: "agent", actorId: "historical-agent" },
      },
    });
    expect(
      await database.db.query.financeBudgetVersions.findFirst({
        where: eq(financeBudgetVersions.id, f.proposal.data.id),
      }),
    ).toMatchObject({ approvedByActorType: "agent", approvedByActorId: "historical-agent" });
  });
});
