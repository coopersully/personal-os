import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  executionPolicySettings,
  financeAccounts,
  financeCategories,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import type { Principal } from "../types.js";
import { loadFinanceAuthorization } from "./context.js";
import { createProfileBudgetService } from "./profile-budget-service.js";

describe.sequential("Finance profile and budget lifecycle", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let userId: string;
  const now = new Date("2026-08-23T20:00:00.000Z");

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine")
      .withDatabase("personal_os")
      .withUsername("personal_os")
      .withPassword("personal_os")
      .start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
    const [user] = await database.db
      .insert(users)
      .values({
        displayName: "Finance planning",
        email: "finance-planning@example.com",
        passwordHash: "unused",
      })
      .returning();
    if (!user) throw new Error("Fixture user was not created.");
    userId = user.id;
    await database.db.insert(executionPolicySettings).values({
      reviewBypassEnabled: true,
      userId,
    });
  }, 120_000);

  afterAll(async () => {
    await database.close();
    await container.stop();
  });

  it("serializes concurrent profile version allocation per user", async () => {
    const [profileUser] = await database.db
      .insert(users)
      .values({
        displayName: "Concurrent profile",
        email: "concurrent-profile@example.com",
        passwordHash: "unused",
      })
      .returning();
    if (!profileUser) throw new Error("Concurrent profile user was not created.");
    const service = createProfileBudgetService({ db: database.db, now: () => now });
    const context = await loadFinanceAuthorization({
      db: database.db,
      principal: {
        actorId: profileUser.id,
        actorType: "user",
        scopes: new Set(["finances:write"]),
        userId: profileUser.id,
      },
      requestId: "concurrent-profile",
    });
    const outcomes = await Promise.allSettled([
      service.updateFinancialProfile(
        {
          changes: { householdSize: 1 },
          expectedVersion: 0,
          idempotencyKey: "concurrent-profile-a",
        },
        context,
      ),
      service.updateFinancialProfile(
        {
          changes: { householdSize: 2 },
          expectedVersion: 0,
          idempotencyKey: "concurrent-profile-b",
        },
        context,
      ),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ code: "conflict" }) }),
    ]);
    await expect(service.getFinancialProfile(profileUser.id)).resolves.toMatchObject({
      data: { version: 1 },
    });
  });

  it("preserves typed planning facts and provenance across later profile revisions", async () => {
    const [owner] = await database.db
      .insert(users)
      .values({
        displayName: "Planning facts",
        email: "planning-facts@example.com",
        passwordHash: "unused",
      })
      .returning();
    if (!owner) throw new Error("Missing fixture owner");
    const context = await loadFinanceAuthorization({
      db: database.db,
      principal: {
        actorId: owner.id,
        actorType: "user",
        scopes: new Set(["finances:write"]),
        userId: owner.id,
      },
      requestId: "planning-facts",
    });
    const service = createProfileBudgetService({ db: database.db, now: () => now });
    const first = await service.updateFinancialProfile(
      {
        expectedVersion: 0,
        idempotencyKey: "facts-first",
        changes: {
          planning: {
            recurringIncome: {
              amountCents: 100_000,
              nextDate: null,
              provenance: {
                actorId: "forged",
                actorType: "agent",
                confidence: 1,
                evidence: { sessionId: "forged-session" },
                maintenanceRunId: null,
                observedAt: now.toISOString(),
                requestId: "forged",
                sourceId: "forged-session",
              },
            },
            uncertainIncome: [],
            exceptionalResources: [],
            obligations: [],
            contributions: [],
            priorities: [],
          },
        },
      },
      context,
    );
    expect(first.data.planning).toMatchObject({
      recurringIncome: {
        amountCents: 100_000,
        nextDate: null,
        provenance: {
          actorId: owner.id,
          actorType: "user",
          requestId: "planning-facts",
          sourceId: null,
          evidence: {},
        },
      },
      obligations: [],
    });
    const second = await service.updateFinancialProfile(
      { expectedVersion: 1, idempotencyKey: "facts-second", changes: { householdSize: 2 } },
      context,
    );
    expect(second.data.planning).toEqual(first.data.planning);
    expect(second.data.provenance.planning).toEqual(first.data.provenance.planning);
    if (!second.data.planning) throw new Error("Missing planning facts");
    const third = await service.updateFinancialProfile(
      {
        expectedVersion: 2,
        idempotencyKey: "facts-third",
        changes: { planning: second.data.planning },
      },
      { ...context, requestId: "later-request" },
    );
    expect(third.data.planning?.recurringIncome?.provenance).toEqual(
      first.data.planning?.recurringIncome?.provenance,
    );
    for (const [field, item] of [
      ["obligations", { debtAccountId: "11111111-1111-4111-8111-111111111111" }],
      ["contributions", { goalId: "11111111-1111-4111-8111-111111111111" }],
      ["priorities", { categoryId: "11111111-1111-4111-8111-111111111111", protected: true }],
    ] as const) {
      await expect(
        service.updateFinancialProfile(
          {
            expectedVersion: 3,
            idempotencyKey: `foreign-${field}`,
            changes: {
              planning: {
                ...second.data.planning,
                [field]: [
                  {
                    id: "22222222-2222-4222-8222-222222222222",
                    name: "Invalid reference",
                    amountCents: 100,
                    dueDay: 1,
                    provenance: second.data.planning.recurringIncome?.provenance,
                    ...item,
                  },
                ],
              },
            },
          },
          context,
        ),
      ).rejects.toMatchObject({ code: "invalid_request" });
    }
    await expect(service.getFinancialProfile(owner.id)).resolves.toMatchObject({
      data: { version: 3 },
    });
  });

  it("persists profile answers and activates a balanced successor budget", async () => {
    const service = createProfileBudgetService({ db: database.db, now: () => now });
    const principal: Principal = {
      actorId: "finance-agent",
      actorType: "agent",
      scopes: new Set(["finances:read", "finances:write"]),
      userId,
    };
    const context = await loadFinanceAuthorization({
      db: database.db,
      principal,
      requestId: "planning-request",
    });
    const profile = await service.updateFinancialProfile(
      {
        changes: {
          expectedMonthlyTakeHome: 8_000,
          householdSize: 1,
          incomeStability: "stable",
        },
        expectedVersion: 0,
        idempotencyKey: "profile-1",
      },
      context,
    );
    expect(profile.data.version).toBe(1);

    const [housing] = await database.db
      .insert(financeCategories)
      .values({ group: "Needs", name: "Housing", slug: "housing", userId })
      .returning();
    if (!housing) throw new Error("Housing category was not created.");
    const goalResult = await service.manageFinanceGoal(
      {
        deadline: "2027-08-01",
        idempotencyKey: "goal-1",
        name: "Emergency reserve",
        operation: "create",
        priority: "high",
        targetAmount: 12_000,
      },
      context,
    );
    const goal = goalResult.data;

    const proposed = await service.createFinanceBudget(
      {
        allocations: [
          { amount: 5_800, categoryId: housing.id, key: "living", kind: "spending" },
          { amount: 2_000, goalId: goal.id, key: "reserve", kind: "goal" },
          { amount: 200, key: "buffer", kind: "buffer" },
        ],
        assumptions: ["Take-home pay remains stable."],
        effectiveFrom: "2026-09",
        idempotencyKey: "budget-1",
        name: "Monthly plan",
        rationale: "Cover living costs, build reserves, and retain a buffer.",
        resources: [{ amount: 8_000, key: "take-home", kind: "income" }],
      },
      context,
    );
    expect(proposed.data).toMatchObject({ balanceDelta: 0, status: "proposed", version: 1 });
    expect(proposed.communication.requiredDisclosures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining("$8,000") }),
      ]),
    );

    await expect(
      service.approveFinanceBudget(
        {
          approvalSource: "agent_self_approval",
          budgetVersionId: proposed.data.id,
          expectedVersion: proposed.data.version,
          idempotencyKey: "approve-1-denied",
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    const active = await service.approveFinanceBudget(
      {
        approvalSource: "user_instruction",
        expectedProfileVersionId: (await service.getFinancialProfile(userId)).data?.id ?? null,
        budgetVersionId: proposed.data.id,
        expectedVersion: proposed.data.version,
        idempotencyKey: "approve-1",
      },
      { ...context, actorType: "user", actorId: userId },
    );
    expect(active.data).toMatchObject({ balanceDelta: 0, status: "active" });

    const revised = await service.reviseFinanceBudget(
      {
        allocations: [
          { amount: 5_500, categoryId: housing.id, key: "living", kind: "spending" },
          { amount: 2_200, goalId: goal.id, key: "reserve", kind: "goal" },
          { amount: 300, key: "buffer", kind: "buffer" },
        ],
        assumptions: [],
        effectiveFrom: "2026-09",
        expectedVersion: active.data.version,
        idempotencyKey: "budget-2",
        name: "Monthly plan",
        planId: active.data.planId,
        rationale: "Increase savings while preserving a buffer.",
        resources: [{ amount: 8_000, key: "take-home", kind: "income" }],
      },
      context,
    );
    await database.db
      .update(executionPolicySettings)
      .set({ reviewBypassEnabled: false, version: 2 })
      .where(eq(executionPolicySettings.userId, userId));
    const noBypass = await loadFinanceAuthorization({
      db: database.db,
      principal,
      requestId: "planning-request-2",
    });
    await expect(
      service.approveFinanceBudget(
        {
          approvalSource: "agent_self_approval",
          budgetVersionId: revised.data.id,
          expectedVersion: revised.data.version,
          idempotencyKey: "approve-2-denied",
        },
        noBypass,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      service.approveFinanceBudget(
        {
          approvalSource: "user_instruction",
          expectedProfileVersionId: (await service.getFinancialProfile(userId)).data?.id ?? null,
          budgetVersionId: revised.data.id,
          expectedVersion: revised.data.version,
          idempotencyKey: "approve-2",
        },
        { ...noBypass, actorType: "user", actorId: userId },
      ),
    ).resolves.toMatchObject({ data: { status: "active", version: 2 } });

    await expect(service.getFinancialProfile(userId)).resolves.toMatchObject({
      data: { version: 1 },
    });
    await expect(service.getFinanceBudget(userId, active.data.planId)).resolves.toMatchObject({
      data: { version: 2 },
    });
    await expect(service.getFinanceBudgetStatus(userId)).resolves.toMatchObject({
      data: { status: "active", version: 2 },
    });
    await expect(
      service.approveFinanceBudget(
        {
          approvalSource: "user_instruction",
          expectedProfileVersionId: (await service.getFinancialProfile(userId)).data?.id ?? null,
          budgetVersionId: revised.data.id,
          expectedVersion: revised.data.version,
          idempotencyKey: "approve-active",
        },
        { ...noBypass, actorType: "user", actorId: userId },
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      service.reviseFinanceBudget(
        {
          allocations: [{ amount: 8000, key: "buffer", kind: "buffer" }],
          assumptions: [],
          effectiveFrom: "2026-09",
          expectedVersion: 1,
          idempotencyKey: "budget-stale-revision",
          name: "Monthly plan",
          planId: active.data.planId,
          rationale: "Stale fixture.",
          resources: [{ amount: 8000, key: "take-home", kind: "income" }],
        },
        noBypass,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(service.listFinanceGoals(userId)).resolves.toMatchObject({
      data: [expect.objectContaining({ id: goal.id })],
    });
    const updatedGoal = await service.manageFinanceGoal(
      {
        changes: { name: "Six-month reserve", targetAmount: 15_000 },
        expectedVersion: 1,
        goalId: goal.id,
        idempotencyKey: "goal-update",
        operation: "update",
      },
      noBypass,
    );
    const pausedGoal = await service.manageFinanceGoal(
      {
        expectedVersion: updatedGoal.data.version,
        goalId: goal.id,
        idempotencyKey: "goal-pause",
        operation: "pause",
      },
      noBypass,
    );
    const resumedGoal = await service.manageFinanceGoal(
      {
        expectedVersion: pausedGoal.data.version,
        goalId: goal.id,
        idempotencyKey: "goal-resume",
        operation: "resume",
      },
      noBypass,
    );
    await expect(
      service.manageFinanceGoal(
        {
          expectedVersion: resumedGoal.data.version,
          goalId: goal.id,
          idempotencyKey: "goal-complete",
          operation: "complete",
        },
        noBypass,
      ),
    ).resolves.toMatchObject({ data: { status: "completed" } });
    await expect(
      service.manageFinanceGoal(
        {
          expectedVersion: 1,
          goalId: "00000000-0000-4000-8000-000000000000",
          idempotencyKey: "goal-missing",
          operation: "pause",
        },
        noBypass,
      ),
    ).rejects.toMatchObject({ code: "not_found" });

    const newestPlan = await service.createFinanceBudget(
      {
        allocations: [{ amount: 8_000, key: "buffer", kind: "buffer" }],
        assumptions: [],
        effectiveFrom: "2026-10",
        idempotencyKey: "budget-newest-plan",
        name: "October plan",
        rationale: "Newest plan fixture.",
        resources: [{ amount: 8_000, key: "take-home", kind: "income" }],
      },
      noBypass,
    );
    await expect(service.getFinanceBudget(userId)).resolves.toMatchObject({
      data: { id: newestPlan.data.id },
    });
  });

  it("binds user decisions to current profile and proposal revisions and replays only exact decisions", async () => {
    const [owner] = await database.db
      .insert(users)
      .values({ displayName: "Decision", email: "decision@example.com", passwordHash: "unused" })
      .returning();
    if (!owner) throw new Error("Missing fixture");
    const context = await loadFinanceAuthorization({
      db: database.db,
      principal: {
        actorId: owner.id,
        actorType: "user",
        userId: owner.id,
        scopes: new Set(["finances:write"]),
      },
      requestId: "decision",
    });
    const service = createProfileBudgetService({ db: database.db, now: () => now });
    const profile = await service.updateFinancialProfile(
      { changes: { householdSize: 1 }, expectedVersion: 0, idempotencyKey: "decision-profile" },
      context,
    );
    const input = {
      allocations: [{ amount: 100, kind: "buffer" as const, key: "buffer" }],
      resources: [{ amount: 100, kind: "income" as const, key: "income" }],
      assumptions: [],
      effectiveFrom: "2026-09",
      name: "Stated plan",
      rationale: "Explicit stated plan.",
      idempotencyKey: "decision-plan",
    };
    const proposal = await service.createFinanceBudget(input, context);
    const decision = {
      approvalSource: "user_instruction" as const,
      budgetVersionId: proposal.data.id,
      expectedVersion: proposal.data.version,
      expectedProfileVersionId: profile.data.id,
      idempotencyKey: "decision-approve",
    };
    await expect(
      service.approveFinanceBudget({ ...decision, expectedProfileVersionId: null }, context),
    ).rejects.toMatchObject({ code: "conflict" });
    const changed = await service.updateFinancialProfile(
      {
        changes: { householdSize: 2 },
        expectedVersion: 1,
        idempotencyKey: "decision-profile-next",
      },
      context,
    );
    await expect(
      service.approveFinanceBudget({ ...decision, idempotencyKey: "decision-stale" }, context),
    ).rejects.toMatchObject({ code: "conflict" });
    const revised = await service.reviseFinanceBudget(
      {
        ...input,
        idempotencyKey: "decision-revise",
        planId: proposal.data.planId,
        expectedVersion: proposal.data.version,
      },
      context,
    );
    const currentDecision = {
      ...decision,
      budgetVersionId: revised.data.id,
      expectedVersion: revised.data.version,
      expectedProfileVersionId: changed.data.id,
      idempotencyKey: "decision-current",
    };
    const active = await service.approveFinanceBudget(currentDecision, context);
    expect(active.data.status).toBe("active");
    expect(await service.approveFinanceBudget(currentDecision, context)).toEqual(active);
    await expect(
      service.approveFinanceBudget({ ...currentDecision, expectedVersion: 99 }, context),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      service.approveFinanceBudget(
        { ...currentDecision, idempotencyKey: "decision-other" },
        { ...context, userId },
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects an unbalanced budget proposal", async () => {
    const service = createProfileBudgetService({ db: database.db, now: () => now });
    const context = await loadFinanceAuthorization({
      db: database.db,
      principal: {
        actorId: userId,
        actorType: "user",
        scopes: new Set(["finances:write"]),
        userId,
      },
      requestId: "unbalanced",
    });
    const [emptyUser] = await database.db
      .insert(users)
      .values({
        displayName: "Empty planning",
        email: "empty-planning@example.com",
        passwordHash: "unused",
      })
      .returning();
    if (!emptyUser) throw new Error("Empty planning user missing.");
    await expect(service.getFinancialProfile(emptyUser.id)).resolves.toMatchObject({ data: null });
    await expect(service.getFinanceBudget(emptyUser.id)).resolves.toMatchObject({ data: null });
    await expect(service.getFinanceBudgetStatus(emptyUser.id)).resolves.toMatchObject({
      data: null,
    });
    await expect(
      service.createFinanceBudget(
        {
          allocations: [{ amount: 900, key: "buffer", kind: "buffer" }],
          assumptions: [],
          effectiveFrom: "2026-10",
          idempotencyKey: "unbalanced-budget",
          name: "Unbalanced",
          rationale: "Fixture",
          resources: [{ amount: 1_000, key: "income", kind: "income" }],
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      service.updateFinancialProfile(
        {
          changes: { dependents: 1 },
          expectedVersion: 0,
          idempotencyKey: "stale-profile",
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      service.createFinanceBudget(
        {
          allocations: [{ amount: 1000, key: "missing-category", kind: "spending" }],
          assumptions: [],
          effectiveFrom: "2026-10",
          idempotencyKey: "missing-category-budget",
          name: "Missing category",
          rationale: "Fixture",
          resources: [{ amount: 1000, key: "income", kind: "income" }],
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      service.reviseFinanceBudget(
        {
          allocations: [{ amount: 1000, key: "buffer", kind: "buffer" }],
          assumptions: [],
          effectiveFrom: "2026-10",
          expectedVersion: 1,
          idempotencyKey: "missing-plan-budget",
          name: "Missing",
          planId: "00000000-0000-4000-8000-000000000000",
          rationale: "Fixture",
          resources: [{ amount: 1000, key: "income", kind: "income" }],
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      service.getFinanceBudget(userId, "00000000-0000-4000-8000-000000000000"),
    ).resolves.toMatchObject({ data: null });
    await expect(
      service.approveFinanceBudget(
        {
          approvalSource: "user_instruction",
          expectedProfileVersionId: (await service.getFinancialProfile(userId)).data?.id ?? null,
          budgetVersionId: "00000000-0000-4000-8000-000000000000",
          expectedVersion: 1,
          idempotencyKey: "missing-budget-approval",
        },
        { ...context, actorType: "user", actorId: userId },
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    for (const [key, allocation] of [
      [
        "foreign-category",
        {
          amount: 100,
          categoryId: "00000000-0000-4000-8000-000000000000",
          key: "spending",
          kind: "spending" as const,
        },
      ],
      [
        "foreign-account",
        {
          accountId: "00000000-0000-4000-8000-000000000000",
          amount: 100,
          key: "debt",
          kind: "debt" as const,
        },
      ],
      [
        "foreign-goal",
        {
          amount: 100,
          goalId: "00000000-0000-4000-8000-000000000000",
          key: "goal",
          kind: "goal" as const,
        },
      ],
    ] as const) {
      await expect(
        service.createFinanceBudget(
          {
            allocations: [allocation],
            assumptions: [],
            effectiveFrom: "2026-10",
            idempotencyKey: `${key}-budget`,
            name: key,
            rationale: "Invalid ownership fixture.",
            resources: [{ amount: 100, key: "income", kind: "income" }],
          },
          context,
        ),
      ).rejects.toMatchObject({ code: "invalid_request" });
    }

    const [debtAccount] = await database.db
      .insert(financeAccounts)
      .values({ institution: "Lender", kind: "debt", name: "Loan", provider: "manual", userId })
      .returning();
    const goal = (await service.listFinanceGoals(userId)).data[0];
    if (!debtAccount || !goal) throw new Error("Allocation fixtures missing.");
    await expect(
      service.createFinanceBudget(
        {
          allocations: [
            {
              accountId: debtAccount.id,
              amount: 100,
              description: "Extra principal",
              key: "debt",
              kind: "debt",
            },
            { amount: 100, goalId: goal.id, key: "savings", kind: "savings" },
            { amount: 100, key: "buffer", kind: "buffer" },
          ],
          assumptions: [],
          effectiveFrom: "2026-10",
          idempotencyKey: "allocation-kinds-budget",
          name: "Allocation kinds",
          rationale: "Exercise all allocation destinations.",
          resources: [{ amount: 300, key: "income", kind: "income" }],
        },
        context,
      ),
    ).resolves.toMatchObject({ data: { balanceDelta: 0 } });
    const allFields = await service.manageFinanceGoal(
      {
        changes: {
          deadline: null,
          name: "Updated reserve",
          priority: "medium",
          targetAmount: 16000,
        },
        expectedVersion: goal.version,
        goalId: goal.id,
        idempotencyKey: "goal-all-fields",
        operation: "update",
      },
      context,
    );
    expect(allFields).toMatchObject({ data: { priority: "medium" } });
    await expect(
      service.manageFinanceGoal(
        {
          expectedVersion: goal.version,
          goalId: goal.id,
          idempotencyKey: "goal-stale",
          operation: "remove",
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      service.manageFinanceGoal(
        {
          expectedVersion: allFields.data.version,
          goalId: goal.id,
          idempotencyKey: "goal-remove",
          operation: "remove",
        },
        context,
      ),
    ).resolves.toMatchObject({ data: { status: "removed" } });
  });

  it("rejects invalid cents and stale proposals while preserving incomplete revisions", async () => {
    const [owner] = await database.db
      .insert(users)
      .values({
        displayName: "Exact cents",
        email: "exact-cents@example.com",
        passwordHash: "unused",
      })
      .returning();
    if (!owner) throw new Error("Missing owner");
    const context = await loadFinanceAuthorization({
      db: database.db,
      principal: {
        actorId: owner.id,
        actorType: "user",
        userId: owner.id,
        scopes: new Set(["finances:write"]),
      },
      requestId: "exact-cents",
    });
    const service = createProfileBudgetService({ db: database.db, now: () => now });
    const input = {
      allocations: [],
      resources: [],
      assumptions: [],
      effectiveFrom: "2026-09",
      name: "Unfinished plan",
      rationale: "Unknown income",
      status: "incomplete" as const,
      idempotencyKey: "incomplete-first",
    };
    for (const amount of [-1, 0.001, Infinity, 21_474_836.48]) {
      await expect(
        service.createFinanceBudget(
          {
            ...input,
            idempotencyKey: `invalid-${amount}`,
            resources: [{ key: "income", kind: "income", amount }],
          },
          context,
        ),
      ).rejects.toMatchObject({ code: "invalid_request" });
    }
    expect((await service.getFinanceBudget(owner.id)).data).toBeNull();
    const draft = (await service.createFinanceBudget(input, context)).data;
    const revision = await service.reviseFinanceBudget(
      {
        ...input,
        idempotencyKey: "incomplete-revision",
        expectedVersion: draft.version,
        planId: draft.planId,
      },
      context,
    );
    expect(revision.data).toMatchObject({
      status: "incomplete",
      profileVersionId: null,
      version: 2,
    });
    expect(revision.communication.headline).toContain("incomplete");
    const complete = {
      ...input,
      resources: [{ key: "income", kind: "income" as const, amount: 100 }],
      allocations: [{ key: "buffer", kind: "buffer" as const, amount: 100 }],
      status: "proposed" as const,
      planId: draft.planId,
      expectedVersion: 2,
      idempotencyKey: "complete-first",
    };
    const proposal = (await service.reviseFinanceBudget(complete, context)).data;
    await expect(
      service.approveFinanceBudget(
        {
          budgetVersionId: proposal.id,
          expectedVersion: proposal.version + 1,
          approvalSource: "user_instruction",
          idempotencyKey: "wrong-proposal-revision",
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    const newer = (
      await service.reviseFinanceBudget(
        { ...complete, expectedVersion: proposal.version, idempotencyKey: "complete-successor" },
        context,
      )
    ).data;
    await expect(
      service.approveFinanceBudget(
        {
          budgetVersionId: proposal.id,
          expectedVersion: proposal.version,
          approvalSource: "user_instruction",
          idempotencyKey: "superseded-proposal",
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      service.approveFinanceBudget(
        {
          budgetVersionId: newer.id,
          expectedVersion: newer.version,
          approvalSource: "user_instruction",
          expectedProfileVersionId: null,
          idempotencyKey: "current-proposal",
        },
        context,
      ),
    ).resolves.toMatchObject({ data: { status: "active", profileVersionId: null } });
  });
});
