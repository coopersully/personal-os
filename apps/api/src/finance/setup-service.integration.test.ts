import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  executionPolicySettings,
  financeAccounts,
  financeBudgetVersions,
  financeGoals,
  financeMaintenanceRuns,
  financeProfileVersions,
  financeSetupSessions,
  migrateDatabase,
  users,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { loadFinanceAuthorization } from "./context.js";
import { createProfileBudgetService } from "./profile-budget-service.js";
import { createSetupService } from "./setup-service.js";

async function skipRemaining(
  service: ReturnType<typeof createSetupService>,
  initial: Awaited<ReturnType<ReturnType<typeof createSetupService>["setupFinances"]>>,
  context: Awaited<ReturnType<typeof loadFinanceAuthorization>>,
) {
  let result = initial;
  for (let count = 0; result.data.question && count < 20; count++) {
    const input = {
      operation: "skip" as const,
      sessionId: result.data.sessionId,
      expectedVersion: result.data.version,
      questionId: result.data.question.id,
      idempotencyKey: `skip:${result.data.sessionId}:${result.data.version}`,
    };
    result = await service.setupFinances(input, context);
    expect(await service.setupFinances(input, context)).toEqual(result);
  }
  return result;
}

describe.sequential("guided Finance setup", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let userId: string;

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
      .values({ displayName: "Setup", email: "setup@example.com", passwordHash: "unused" })
      .returning();
    if (!user) throw new Error("Fixture user was not created.");
    userId = user.id;
    await database.db.insert(executionPolicySettings).values({ reviewBypassEnabled: true, userId });
  }, 120_000);

  afterAll(async () => {
    await database.close();
    await container.stop();
  });

  it("resumes a setup proposal revised and approved through another Finance surface", async () => {
    const [owner] = await database.db
      .insert(users)
      .values({
        displayName: "Portal setup",
        email: "portal-setup@example.com",
        passwordHash: "unused",
      })
      .returning();
    if (!owner) throw new Error("Fixture user was not created.");
    const now = () => new Date("2026-08-23T20:00:00Z");
    const planning = createProfileBudgetService({ db: database.db, now });
    const service = createSetupService({ db: database.db, now, planning });
    const context = await loadFinanceAuthorization({
      db: database.db,
      principal: {
        actorId: owner.id,
        actorType: "user",
        scopes: new Set(["finances:write"]),
        userId: owner.id,
      },
      requestId: "cross-surface-setup",
    });
    await planning.updateFinancialProfile(
      {
        expectedVersion: 0,
        idempotencyKey: "cross-profile",
        changes: {
          jurisdiction: "US-NY",
          householdSize: 1,
          expectedMonthlyTakeHome: 4000,
          liquidReserves: 2000,
        },
      },
      context,
    );
    const started = await skipRemaining(
      service,
      await service.setupFinances({ operation: "start" }, context),
      context,
    );
    const original = (await planning.getFinanceBudget(owner.id)).data;
    if (!original) throw new Error("Setup proposal missing.");
    const revised = await planning.reviseFinanceBudget(
      {
        planId: original.planId,
        expectedVersion: original.version,
        idempotencyKey: "cross-revise",
        effectiveFrom: original.effectiveFrom,
        name: "Updated portal plan",
        resources: [{ amount: 4000, key: "income", kind: "income" }],
        allocations: [{ amount: 4000, key: "buffer", kind: "buffer" }],
        assumptions: original.assumptions,
        rationale: "Revised in the portal.",
      },
      context,
    );
    const resumed = await service.setupFinances(
      { operation: "resume", sessionId: started.data.sessionId },
      context,
    );
    expect(resumed.data).toMatchObject({
      budgetVersionId: revised.data.id,
      stage: "budget_approval",
      version: started.data.version + 1,
    });
    await planning.approveFinanceBudget(
      {
        budgetVersionId: revised.data.id,
        expectedVersion: revised.data.version,
        approvalSource: "user_instruction",
        expectedProfileVersionId: revised.data.profileVersionId,
        idempotencyKey: "cross-approve",
      },
      context,
    );
    const ready = await service.setupFinances(
      { operation: "resume", sessionId: started.data.sessionId },
      context,
    );
    expect(ready.data).toMatchObject({
      budgetVersionId: revised.data.id,
      stage: "initial_maintenance",
      version: resumed.data.version + 1,
    });
    expect(ready.nextAction?.tool).toBe("maintain_finances");
    expect(
      (
        await service.setupFinances(
          { operation: "resume", sessionId: started.data.sessionId },
          context,
        )
      ).data.version,
    ).toBe(ready.data.version);
  });

  it("persists unknown skips, recovers interruptions, and keeps an absent position incomplete", async () => {
    const now = () => new Date("2026-08-23T20:00:00Z");
    const planning = createProfileBudgetService({ db: database.db, now });
    let service = createSetupService({ db: database.db, now, planning });
    const context = await loadFinanceAuthorization({
      db: database.db,
      principal: {
        actorId: "agent",
        actorType: "agent",
        scopes: new Set(["finances:write"]),
        userId,
      },
      requestId: "setup",
    });
    const starts = await Promise.all([
      service.setupFinances({ operation: "start" }, context),
      service.setupFinances({ operation: "start" }, context),
    ]);
    expect(starts[1]?.data).toEqual(starts[0]?.data);
    let response = starts[0];
    if (!response) throw new Error("Missing setup response");
    const stale = response;
    await planning.updateFinancialProfile(
      { expectedVersion: 0, idempotencyKey: "outside-profile", changes: { jurisdiction: "US-NY" } },
      context,
    );
    await expect(
      service.setupFinances(
        {
          operation: "answer",
          answer: "US-CA",
          expectedVersion: stale.data.version,
          questionId: "profile:location",
          sessionId: stale.data.sessionId,
          idempotencyKey: "stale-answer",
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    response = await service.setupFinances(
      { operation: "resume", sessionId: response.data.sessionId },
      context,
    );
    expect(response.data.question?.id).toBe("profile:household_size");
    const skipped = await service.setupFinances(
      {
        operation: "skip",
        expectedVersion: response.data.version,
        questionId: "profile:household_size",
        sessionId: response.data.sessionId,
        idempotencyKey: "skip-household",
      },
      context,
    );
    service = createSetupService({ db: database.db, now, planning });
    response = await service.setupFinances(
      { operation: "resume", sessionId: skipped.data.sessionId },
      context,
    );
    expect(response.data.question?.id).toBe("profile:monthly_take_home");
    response = await skipRemaining(service, response, context);
    expect(response).toMatchObject({
      outcome: "work_remaining",
      data: {
        stage: "budget_proposal",
        position: { state: "unavailable", reasonCode: "producer_not_registered" },
      },
    });
    const draft = (await planning.getFinanceBudget(userId)).data;
    if (!draft) throw new Error("Missing first plan");
    expect(draft).toMatchObject({
      status: "incomplete",
      allocations: [],
      resources: [],
      expectedResources: 0,
      profileVersionId: expect.any(String),
    });
    expect((await planning.getFinancialProfile(userId)).data).toMatchObject({
      householdSize: null,
      expectedMonthlyTakeHome: null,
      planning: null,
    });
    expect(
      (
        await service.setupFinances(
          { operation: "resume", sessionId: response.data.sessionId },
          context,
        )
      ).data.budgetVersionId,
    ).toBe(draft.id);
    expect(
      await database.db
        .select()
        .from(financeBudgetVersions)
        .where(eq(financeBudgetVersions.userId, userId)),
    ).toHaveLength(1);
    await expect(
      planning.approveFinanceBudget(
        {
          approvalSource: "user_instruction",
          budgetVersionId: draft.id,
          expectedVersion: draft.version,
          expectedProfileVersionId: draft.profileVersionId,
          idempotencyKey: "agent-forged-user",
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      planning.approveFinanceBudget(
        {
          approvalSource: "user_instruction",
          budgetVersionId: draft.id,
          expectedVersion: draft.version,
          expectedProfileVersionId: draft.profileVersionId,
          idempotencyKey: "user-incomplete",
        },
        { ...context, actorType: "user", actorId: userId },
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    const [other] = await database.db
      .insert(users)
      .values({ displayName: "Other", email: "setup-other@example.com", passwordHash: "unused" })
      .returning();
    if (!other) throw new Error("Missing fixture");
    await expect(
      service.setupFinances(
        { operation: "resume", sessionId: response.data.sessionId },
        { ...context, userId: other.id },
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      service.setupFinances({ operation: "start" }, { ...context, canMutate: false }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      await database.db
        .select()
        .from(financeProfileVersions)
        .where(eq(financeProfileVersions.userId, userId)),
    ).toHaveLength(1);
  });

  it.each([
    { amount: 10000, linked: false },
    { amount: null, linked: false },
    { amount: 10000, linked: true },
    { amount: null, linked: true },
  ])("reuses known debt minimums once with obligation $amount and account link $linked", async ({
    amount: obligationAmount,
    linked,
  }) => {
    const [owner] = await database.db
      .insert(users)
      .values({
        displayName: "Deficit",
        email: `deficit-${obligationAmount}-${linked}@example.com`,
        passwordHash: "unused",
      })
      .returning();
    if (!owner) throw new Error("Missing fixture");
    const [goal] = await database.db
      .insert(financeGoals)
      .values({ userId: owner.id, name: "Reserve goal", targetAmount: 500000 })
      .returning();
    if (!goal) throw new Error("Missing goal");
    const [debtAccount] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "Lender",
        kind: "debt",
        name: "Known debt",
        provider: "manual",
        userId: owner.id,
      })
      .returning();
    if (!debtAccount) throw new Error("Missing debt account");
    const now = () => new Date("2026-09-18T12:00:00Z");
    const planning = createProfileBudgetService({ db: database.db, now });
    const context = await loadFinanceAuthorization({
      db: database.db,
      principal: {
        actorId: owner.id,
        actorType: "user",
        userId: owner.id,
        scopes: new Set(["finances:write"]),
      },
      requestId: "deficit",
    });
    const provenance = {
      actorId: owner.id,
      actorType: "user" as const,
      confidence: 1,
      evidence: {},
      maintenanceRunId: null,
      observedAt: now().toISOString(),
      requestId: "deficit",
      sourceId: null,
    };
    const item = (n: number, name: string, amountCents: number) => ({
      id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
      name,
      amountCents,
      dueDay: 1,
      provenance,
    });
    const profile = await planning.updateFinancialProfile(
      {
        expectedVersion: 0,
        idempotencyKey: "deficit-profile",
        changes: {
          jurisdiction: "US-NY",
          householdSize: 1,
          expectedMonthlyTakeHome: 2000,
          liquidReserves: 10000,
          incomeStability: "variable",
          debts: [
            {
              accountId: linked ? debtAccount.id : null,
              name: "Known debt",
              balance: 1500,
              minimumMonthlyPayment: 100,
              interestRate: null,
            },
          ],
          preferences: {
            bufferTarget: 50,
            debtPriority: "minimums",
            emergencyReserveMonths: null,
            notes: [],
          },
          planning: {
            recurringIncome: { amountCents: 100000, nextDate: "2026-10-01", provenance },
            uncertainIncome: [
              {
                id: item(1, "", 0).id,
                name: "Uncertain pay",
                amountCents: 50000,
                expectedDate: "2026-10-01",
                provenance,
              },
            ],
            exceptionalResources: [
              {
                id: item(2, "", 0).id,
                name: "One-time resource",
                amountCents: 200000,
                expectedDate: "2026-10-01",
                provenance,
              },
            ],
            obligations: [
              { ...item(3, "Rent", 80000), debtAccountId: null },
              {
                ...item(4, "Known debt", 10000),
                amountCents: obligationAmount,
                debtAccountId: linked ? debtAccount.id : null,
              },
            ],
            contributions: [{ ...item(5, "Reserve goal", 20000), goalId: goal.id }],
            priorities: [
              { ...item(6, "Quality of life", 10000), categoryId: null, protected: true },
            ],
          },
        },
      },
      context,
    );
    const service = createSetupService({ db: database.db, now, planning });
    const result = await skipRemaining(
      service,
      await service.setupFinances({ operation: "start" }, context),
      context,
    );
    expect(
      (await planning.getFinancialProfile(owner.id)).data?.planning?.obligations?.[1]?.amountCents,
    ).toBe(obligationAmount);
    expect(result.data).toMatchObject({
      stage: "budget_proposal",
      profileVersionId: profile.data.id,
    });
    const draft = (await planning.getFinanceBudget(owner.id)).data;
    if (!draft) throw new Error("Missing first plan");
    expect(draft).toMatchObject({
      status: "incomplete",
      expectedResources: 1000,
      allocatedTotal: 1250,
      balanceDelta: -250,
    });
    expect(
      draft.allocations.filter((allocation) => allocation.description === "Known debt"),
    ).toHaveLength(1);
    if (obligationAmount === null)
      expect(draft.assumptions).toContain("Known debt: amount unknown.");
    expect(draft.resources).toEqual([{ amount: 1000, key: "recurring-floor", kind: "income" }]);
    expect((await planning.listFinanceGoals(owner.id)).data[0]?.currentAmount).toBe(0);
  });

  it("resumes only live maintenance evidence and restarts after a terminal canonical run", async () => {
    const [owner] = await database.db
      .insert(users)
      .values({
        displayName: "Maintenance handoff",
        email: "maintenance-handoff@example.com",
        passwordHash: "unused",
      })
      .returning();
    if (!owner) throw new Error("Fixture user was not created.");
    const now = () => new Date("2026-08-23T20:00:00Z");
    const planning = createProfileBudgetService({ db: database.db, now });
    const service = createSetupService({ db: database.db, now, planning });
    const context = await loadFinanceAuthorization({
      db: database.db,
      principal: {
        actorId: owner.id,
        actorType: "user",
        scopes: new Set(["finances:write"]),
        userId: owner.id,
      },
      requestId: "maintenance-handoff",
    });
    const [legacy] = await database.db
      .insert(financeMaintenanceRuns)
      .values({ userId: owner.id, scope: { type: "all_outstanding" }, stage: "agent_audit" })
      .returning();
    const [session] = await database.db
      .insert(financeSetupSessions)
      .values({
        userId: owner.id,
        status: "initial_maintenance",
        maintenanceRunId: legacy?.id,
      })
      .returning();
    if (!legacy || !session) throw new Error("Maintenance handoff fixture was not created.");

    await expect(
      service.setupFinances({ operation: "resume", sessionId: session.id }, context),
    ).resolves.toMatchObject({
      nextAction: { arguments: { operation: "resume", runId: legacy.id } },
    });

    const [canonical] = await database.db
      .insert(workspaceMaintenanceRuns)
      .values({
        userId: owner.id,
        domain: "finances",
        scope: { type: "all_outstanding" },
        rulebookVersion: "test-v1",
      })
      .returning();
    if (!canonical) throw new Error("Canonical maintenance fixture was not created.");
    await database.db
      .update(financeSetupSessions)
      .set({ canonicalMaintenanceRunId: canonical.id })
      .where(eq(financeSetupSessions.id, session.id));
    await expect(
      service.setupFinances({ operation: "resume", sessionId: session.id }, context),
    ).resolves.toMatchObject({
      nextAction: { arguments: { operation: "resume", runId: canonical.id } },
    });

    await database.db
      .update(workspaceMaintenanceRuns)
      .set({ status: "completed_with_questions" })
      .where(eq(workspaceMaintenanceRuns.id, canonical.id));
    await expect(
      service.setupFinances({ operation: "resume", sessionId: session.id }, context),
    ).resolves.toMatchObject({
      nextAction: {
        arguments: { operation: "start", scope: { type: "all_outstanding" } },
      },
    });
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({ status: "completed" })
      .where(eq(workspaceMaintenanceRuns.id, canonical.id));
    await expect(
      service.setupFinances({ operation: "resume", sessionId: session.id }, context),
    ).resolves.toMatchObject({
      nextAction: {
        arguments: { operation: "start", scope: { type: "all_outstanding" } },
      },
    });

    await database.db
      .update(financeSetupSessions)
      .set({ canonicalMaintenanceRunId: null })
      .where(eq(financeSetupSessions.id, session.id));
    await database.db
      .update(financeMaintenanceRuns)
      .set({
        canonicalRunId: canonical.id,
        recovery: {
          legacyRunId: legacy.id,
          originalScope: legacy.scope,
          originalStage: legacy.stage,
          reason: "Adopted by the canonical maintenance lifecycle.",
          state: "adopted",
          throughDate: null,
        },
        stage: "superseded",
      })
      .where(eq(financeMaintenanceRuns.id, legacy.id));
    await expect(
      service.setupFinances({ operation: "resume", sessionId: session.id }, context),
    ).resolves.toMatchObject({
      data: { canonicalMaintenanceRunId: canonical.id },
      nextAction: {
        arguments: { operation: "start", scope: { type: "all_outstanding" } },
      },
    });
  });

  it("does not reopen an older legacy setup after a newer canonical session settled", async () => {
    const [owner] = await database.db
      .insert(users)
      .values({
        displayName: "Settled setup history",
        email: "settled-setup-history@example.com",
        passwordHash: "unused",
      })
      .returning();
    if (!owner) throw new Error("Fixture user was not created.");
    const now = () => new Date("2026-08-23T20:00:00Z");
    const planning = createProfileBudgetService({ db: database.db, now });
    const service = createSetupService({ db: database.db, now, planning });
    const context = await loadFinanceAuthorization({
      db: database.db,
      principal: {
        actorId: owner.id,
        actorType: "user",
        scopes: new Set(["finances:write"]),
        userId: owner.id,
      },
      requestId: "settled-setup-history",
    });
    const [canonical] = await database.db
      .insert(workspaceMaintenanceRuns)
      .values({
        userId: owner.id,
        domain: "finances",
        scope: { type: "all_outstanding" },
        status: "completed",
        rulebookVersion: "test-v1",
      })
      .returning();
    if (!canonical) throw new Error("Canonical maintenance fixture was not created.");
    const [older, latest] = await database.db
      .insert(financeSetupSessions)
      .values([
        {
          userId: owner.id,
          status: "settled",
          updatedAt: new Date("2026-08-20T12:00:00Z"),
        },
        {
          userId: owner.id,
          status: "settled",
          canonicalMaintenanceRunId: canonical.id,
          updatedAt: new Date("2026-08-21T12:00:00Z"),
        },
      ])
      .returning();
    if (!older || !latest) throw new Error("Setup history fixtures were not created.");

    await expect(service.setupFinances({ operation: "start" }, context)).resolves.toMatchObject({
      data: {
        canonicalMaintenanceRunId: canonical.id,
        sessionId: latest.id,
        stage: "settled",
      },
      outcome: "completed",
    });
    const savedOlder = await database.db.query.financeSetupSessions.findFirst({
      where: eq(financeSetupSessions.id, older.id),
    });
    expect(savedOlder?.status).toBe("settled");
  });

  async function setupFixture(label: string) {
    const [owner] = await database.db
      .insert(users)
      .values({ displayName: label, email: `${label}@example.com`, passwordHash: "unused" })
      .returning();
    if (!owner) throw new Error("Missing setup owner");
    const now = () => new Date("2026-09-18T12:00:00Z");
    const planning = createProfileBudgetService({ db: database.db, now });
    const context = await loadFinanceAuthorization({
      db: database.db,
      principal: {
        actorId: owner.id,
        actorType: "user",
        userId: owner.id,
        scopes: new Set(["finances:write"]),
      },
      requestId: label,
    });
    return {
      owner,
      planning,
      context,
      service: createSetupService({ db: database.db, now, planning }),
    };
  }

  it("keeps a completely unknown profile absent and invalidates old skips after a profile edit", async () => {
    const { owner, planning, context, service } = await setupFixture("unknown-profile");
    const first = await service.setupFinances({ operation: "start" }, context);
    const input = {
      operation: "skip" as const,
      sessionId: first.data.sessionId,
      questionId: "profile:location",
      expectedVersion: first.data.version,
      idempotencyKey: "unknown-skip",
    };
    await expect(
      service.setupFinances({ ...input, sessionId: crypto.randomUUID() }, context),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      service.setupFinances({ ...input, expectedVersion: first.data.version + 1 }, context),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      service.setupFinances({ ...input, questionId: "profile:missing" }, context),
    ).rejects.toMatchObject({ code: "conflict" });
    const saved = await skipRemaining(service, first, context);
    expect((await planning.getFinancialProfile(owner.id)).data).toBeNull();
    expect((await planning.getFinanceBudget(owner.id)).data).toMatchObject({
      profileVersionId: null,
      resources: [],
      allocations: [],
      status: "incomplete",
    });
    expect(
      (
        await service.setupFinances(
          { operation: "resume", sessionId: first.data.sessionId },
          context,
        )
      ).data.budgetVersionId,
    ).toBe(saved.data.budgetVersionId);
    await expect(
      service.setupFinances({ ...input, expectedVersion: saved.data.version }, context),
    ).rejects.toMatchObject({ code: "conflict" });
    await planning.updateFinancialProfile(
      { changes: { householdSize: 1 }, idempotencyKey: "known-household", expectedVersion: 0 },
      context,
    );
    const resumed = await service.setupFinances(
      { operation: "resume", sessionId: first.data.sessionId },
      context,
    );
    expect(resumed.data.question?.id).toBe("profile:location");
    const answered = await service.setupFinances(
      {
        operation: "answer",
        sessionId: resumed.data.sessionId,
        questionId: "profile:location",
        expectedVersion: resumed.data.version,
        answer: "New York",
        idempotencyKey: "known-location",
      },
      context,
    );
    expect(answered.data.question?.id).toBe("profile:monthly_take_home");
  });

  it("bounds first-plan disclosure while preserving all partial planning facts", async () => {
    const { owner, planning, context, service } = await setupFixture("partial-profile");
    const goal = (
      await planning.manageFinanceGoal(
        {
          operation: "create",
          name: "Emergency fund",
          targetAmount: 1000,
          deadline: null,
          priority: "high",
          idempotencyKey: "partial-goal",
        },
        context,
      )
    ).data;
    const provenance = {
      actorId: owner.id,
      actorType: "user" as const,
      confidence: 1,
      evidence: {},
      maintenanceRunId: null,
      observedAt: "2026-09-18T12:00:00Z",
      requestId: "partial-profile",
      sourceId: null,
    };
    const need = (name: string) => ({
      id: crypto.randomUUID(),
      name,
      amountCents: null,
      dueDay: null,
      provenance,
    });
    await planning.updateFinancialProfile(
      {
        expectedVersion: 0,
        idempotencyKey: "partial-input",
        changes: {
          planning: {
            recurringIncome: { amountCents: 100000, nextDate: null, provenance },
            uncertainIncome: [],
            exceptionalResources: [],
            obligations: Array.from({ length: 100 }, (_, index) => ({
              ...need(`Unconfirmed obligation ${index}`),
              debtAccountId: null,
            })),
            contributions: [{ ...need("Goal contribution"), goalId: goal.id }],
            priorities: [
              {
                ...need("Flexible priority"),
                amountCents: 10000,
                categoryId: null,
                protected: false,
              },
            ],
          },
        },
      },
      context,
    );
    const saved = await skipRemaining(
      service,
      await service.setupFinances({ operation: "start" }, context),
      context,
    );
    expect(saved.data.stage).toBe("budget_proposal");
    const draft = (await planning.getFinanceBudget(owner.id)).data;
    expect(draft).toMatchObject({
      status: "incomplete",
      expectedResources: 1000,
      allocatedTotal: 100,
    });
    expect(draft?.assumptions).toHaveLength(100);
    expect(draft?.assumptions[99]).toContain("further unknowns");
    expect(
      saved.communication.requiredDisclosures.every((item) => item.message.length <= 2000),
    ).toBe(true);
    expect(
      saved.communication.requiredDisclosures.some((item) =>
        item.message.includes("Read the full assumptions"),
      ),
    ).toBe(true);
    expect((await planning.getFinancialProfile(owner.id)).data?.planning?.obligations).toHaveLength(
      100,
    );
    expect(
      (await planning.getFinancialProfile(owner.id)).data?.planning?.contributions?.[0]
        ?.amountCents,
    ).toBeNull();
    expect((await planning.listFinanceGoals(owner.id)).data[0]?.currentAmount).toBe(0);
  });

  it("carries unknown skips through real answers and authenticates structured planning provenance", async () => {
    const { owner, planning, context, service } = await setupFixture("answered-profile");
    let result = await service.setupFinances({ operation: "start" }, context);
    const answers: Record<string, string> = {
      "profile:location": "New York",
      "profile:monthly_take_home": "0",
      "profile:income_stability": "stable",
      "profile:debts": "[]",
      "profile:buffer_target": "25",
      "planning:recurringIncome": JSON.stringify({ amountCents: 0, nextDate: "2026-10-01" }),
      "planning:uncertainIncome": "[]",
      "planning:exceptionalResources": "[]",
      "planning:obligations": "[]",
      "planning:contributions": "[]",
      "planning:priorities": "[]",
    };
    for (let count = 0; result.data.question && count < 20; count++) {
      const questionId = result.data.question.id;
      const common = {
        sessionId: result.data.sessionId,
        expectedVersion: result.data.version,
        questionId,
        idempotencyKey: `answer-${count}`,
      };
      result = await service.setupFinances(
        answers[questionId] === undefined
          ? { ...common, operation: "skip" }
          : { ...common, operation: "answer", answer: answers[questionId] },
        context,
      );
    }
    expect(result.data.stage).toBe("budget_proposal");
    const current = (await planning.getFinancialProfile(owner.id)).data;
    expect(current).toMatchObject({
      householdSize: null,
      liquidReserves: null,
      expectedMonthlyTakeHome: 0,
      preferences: { bufferTarget: 25 },
      planning: {
        recurringIncome: {
          amountCents: 0,
          provenance: {
            actorId: owner.id,
            actorType: "user",
            sourceId: result.data.sessionId,
            evidence: { sessionId: result.data.sessionId, questionId: "planning:recurringIncome" },
          },
        },
      },
    });
    expect((await planning.getFinanceBudget(owner.id)).data).toMatchObject({
      status: "incomplete",
      expectedResources: 0,
      allocatedTotal: 25,
      balanceDelta: -25,
    });
    expect(
      (
        await service.setupFinances(
          { operation: "resume", sessionId: result.data.sessionId },
          context,
        )
      ).data.question,
    ).toBeNull();
  });
});
