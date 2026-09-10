import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  financeAccounts,
  financeBudgetPlans,
  financeBudgetVersions,
  financeCategories,
  financeCategoryRules,
  financeEconomicEvents,
  financeEventTransactions,
  financeMaintenanceRuns,
  financeSetupSessions,
  financeTransactions,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import type { Principal } from "../types.js";
import { loadFinanceAuthorization } from "./context.js";
import { createInboxService } from "./inbox-service.js";
import { createMaintenanceService } from "./maintenance-service.js";
import { createProfileBudgetService } from "./profile-budget-service.js";
import { createSetupService } from "./setup-service.js";

describe.sequential("caller-driven Finance maintenance", () => {
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
      .values({
        displayName: "Maintenance",
        email: "maintenance@example.com",
        passwordHash: "unused",
      })
      .returning();
    if (!user) throw new Error("Fixture user was not created.");
    userId = user.id;
  }, 120_000);

  afterAll(async () => {
    await database.close();
    await container.stop();
  });

  async function setupFixture(label: string, priorMaintenance?: "active" | "settled") {
    const [owner] = await database.db
      .insert(users)
      .values({ displayName: label, email: `${label}@example.com`, passwordHash: "unused" })
      .returning();
    if (!owner) throw new Error("Setup owner missing.");
    const now = () => new Date("2026-09-03T12:00:00Z");
    const context = await loadFinanceAuthorization({
      db: database.db,
      principal: {
        actorId: owner.id,
        actorType: "user",
        scopes: new Set(["finances:write"]),
        userId: owner.id,
      },
      requestId: label,
    });
    const inbox = createInboxService({ db: database.db, now });
    const maintenance = createMaintenanceService({ db: database.db, inbox, now });
    const planning = createProfileBudgetService({ db: database.db, now });
    const setup = createSetupService({ db: database.db, now, planning });
    const priorRun = priorMaintenance
      ? await maintenance.maintainFinances(
          { operation: "start", scope: { type: "all_outstanding" } },
          context,
        )
      : null;
    if (priorMaintenance === "settled" && priorRun) {
      await maintenance.maintainFinances(
        {
          operation: "submit_audit",
          runId: priorRun.data.runId,
          expectedVersion: priorRun.data.version,
          findings: [],
          idempotencyKey: `${label}:prior-audit`,
        },
        context,
      );
    }
    await planning.updateFinancialProfile(
      {
        expectedVersion: 0,
        idempotencyKey: `${label}:profile`,
        changes: {
          jurisdiction: "US-NY",
          householdSize: 1,
          expectedMonthlyTakeHome: 4000,
          liquidReserves: 2000,
        },
      },
      context,
    );
    const proposed = await setup.setupFinances({ operation: "start" }, context);
    if (!proposed.data.budgetVersionId) throw new Error("Budget proposal missing.");
    const ready = await setup.setupFinances(
      {
        operation: "approve_budget",
        approvalSource: "user_instruction",
        sessionId: proposed.data.sessionId,
        expectedVersion: proposed.data.version,
        budgetVersionId: proposed.data.budgetVersionId,
        idempotencyKey: `${label}:approve`,
      },
      context,
    );
    const savedSession = () =>
      database.db.query.financeSetupSessions.findFirst({
        where: eq(financeSetupSessions.id, ready.data.sessionId),
      });
    return { context, inbox, maintenance, owner, priorRun, ready, savedSession, setup };
  }

  it("advances synchronously through reasoning and audit to settlement", async () => {
    const now = () => new Date("2026-08-23T20:00:00Z");
    const inbox = createInboxService({ db: database.db, now });
    const service = createMaintenanceService({ db: database.db, inbox, now });
    const [account] = await database.db
      .insert(financeAccounts)
      .values({ institution: "Bank", name: "Checking", provider: "manual", userId })
      .returning();
    const [category] = await database.db
      .insert(financeCategories)
      .values({ group: "Food", name: "Groceries", slug: "groceries", userId })
      .returning();
    if (!account || !category) throw new Error("Fixtures failed.");
    await database.db.insert(financeTransactions).values({
      accountId: account.id,
      amount: 4200,
      direction: "expense",
      merchant: "Local market",
      transactionDate: "2026-08-22",
      userId,
    });
    const principal: Principal = {
      actorId: "agent",
      actorType: "agent",
      scopes: new Set(["finances:write"]),
      userId,
    };
    const context = await loadFinanceAuthorization({
      db: database.db,
      principal,
      requestId: "maintenance",
    });

    const started = await service.maintainFinances(
      { operation: "start", scope: { type: "all_outstanding" } },
      context,
    );
    expect(started.data.stage).toBe("agent_reasoning");
    expect(started.data.reasoningBatch).toHaveLength(1);
    expect(started.nextAction?.tool).toBe("maintain_finances");
    await expect(
      service.maintainFinances({ operation: "start", scope: { type: "all_outstanding" } }, context),
    ).resolves.toMatchObject({ data: { runId: started.data.runId } });
    await expect(
      service.maintainFinances(
        {
          expectedVersion: started.data.version,
          findings: [],
          idempotencyKey: "audit-too-early",
          operation: "submit_audit",
          runId: started.data.runId,
        },
        context,
      ),
    ).rejects.toThrow("not awaiting audit");
    await expect(
      service.maintainFinances(
        {
          expectedVersion: started.data.version + 1,
          idempotencyKey: "judgments-stale",
          judgments: [
            {
              confidence: 0.5,
              questionReason: "Fixture",
              transactionId: started.data.reasoningBatch[0]?.transactionId as string,
              type: "needs_user_review",
            },
          ],
          operation: "submit_judgments",
          runId: started.data.runId,
        },
        context,
      ),
    ).rejects.toThrow("version");

    const item = started.data.reasoningBatch[0];
    if (!item) throw new Error("Reasoning item missing.");
    const reasoned = await service.maintainFinances(
      {
        expectedVersion: started.data.version,
        idempotencyKey: "judgments-1",
        judgments: [
          {
            categoryId: category.id,
            confidence: 0.99,
            meaning: "Routine grocery purchase",
            rationale: "Merchant and amount fit groceries.",
            transactionId: item.transactionId,
            type: "classify_transaction",
          },
        ],
        operation: "submit_judgments",
        runId: started.data.runId,
      },
      context,
    );
    expect(reasoned.data.stage).toBe("agent_audit");
    await expect(
      service.maintainFinances(
        {
          expectedVersion: reasoned.data.version,
          idempotencyKey: "judgments-too-late",
          judgments: [
            {
              confidence: 0.5,
              questionReason: "Fixture",
              transactionId: item.transactionId,
              type: "needs_user_review",
            },
          ],
          operation: "submit_judgments",
          runId: reasoned.data.runId,
        },
        context,
      ),
    ).rejects.toThrow("not awaiting judgments");

    const settled = await service.maintainFinances(
      {
        expectedVersion: reasoned.data.version,
        findings: [],
        idempotencyKey: "audit-1",
        operation: "submit_audit",
        runId: reasoned.data.runId,
      },
      context,
    );
    expect(settled).toMatchObject({ data: { stage: "settled" }, outcome: "completed" });
    await expect(
      service.getFinanceMaintenanceRun(userId, "00000000-0000-4000-8000-000000000000"),
    ).rejects.toThrow("not found");
  });

  it("resumes an audit-only run, persists findings, and exposes history", async () => {
    const now = () => new Date("2026-08-24T20:00:00Z");
    const inbox = createInboxService({ db: database.db, now });
    const service = createMaintenanceService({ db: database.db, inbox, now });
    const principal: Principal = {
      actorId: "agent",
      actorType: "agent",
      scopes: new Set(["finances:write"]),
      userId,
    };
    const context = await loadFinanceAuthorization({
      db: database.db,
      principal,
      requestId: "audit-only",
    });
    const transaction = await database.db.query.financeTransactions.findFirst();
    if (!transaction) throw new Error("Transaction fixture missing.");
    const [event] = await database.db
      .insert(financeEconomicEvents)
      .values({ kind: "purchase", stableKey: "audit-only:event", userId })
      .returning();
    if (!event) throw new Error("Event fixture missing.");
    await database.db.insert(financeEventTransactions).values({
      economicEventId: event.id,
      transactionId: transaction.id,
      userId,
    });
    const started = await service.maintainFinances(
      { operation: "start", scope: { type: "all_outstanding" } },
      context,
    );
    expect(started.data.stage).toBe("agent_audit");
    await expect(
      service.maintainFinances({ operation: "resume", runId: started.data.runId }, context),
    ).resolves.toMatchObject({ data: { stage: "agent_audit" } });
    await expect(
      service.getFinanceMaintenanceRun(userId, started.data.runId),
    ).resolves.toMatchObject({ stage: "agent_audit" });
    await expect(
      service.getFinanceMaintenanceHistory(userId, { limit: 20, status: "agent_audit" }),
    ).resolves.toMatchObject({ items: [expect.objectContaining({ runId: started.data.runId })] });
    const settled = await service.maintainFinances(
      {
        expectedVersion: started.data.version,
        findings: [
          {
            economicEventId: event.id,
            evidence: { baseline: 20, observed: 42 },
            impactAmount: 42,
            rationale: "Materially larger than the recent baseline.",
            reason: "unusual_amount",
          },
        ],
        idempotencyKey: "audit-finding",
        operation: "submit_audit",
        runId: started.data.runId,
      },
      context,
    );
    expect(settled).toMatchObject({ data: { stage: "settled" }, remainingWork: { count: 1 } });
  });

  it("recovers persisted preparation stages after process loss", async () => {
    const now = () => new Date("2026-08-24T22:00:00Z");
    const service = createMaintenanceService({
      db: database.db,
      inbox: createInboxService({ db: database.db, now }),
      now,
    });
    const context = await loadFinanceAuthorization({
      db: database.db,
      principal: {
        actorId: "agent",
        actorType: "agent",
        scopes: new Set(["finances:write"]),
        userId,
      },
      requestId: "recover-maintenance",
    });
    const [run] = await database.db
      .insert(financeMaintenanceRuns)
      .values({
        scope: { from: "2099-01-01", type: "since" },
        stage: "deterministic_processing",
        userId,
      })
      .returning();
    if (!run) throw new Error("Recovery run was not created.");

    const recovered = await service.maintainFinances(
      { operation: "resume", runId: run.id },
      context,
    );
    expect(recovered).toMatchObject({ data: { stage: "agent_audit" } });
    await service.maintainFinances(
      {
        expectedVersion: recovered.data.version,
        findings: [],
        idempotencyKey: "settle-recovered-maintenance",
        operation: "submit_audit",
        runId: run.id,
      },
      context,
    );
    await database.db
      .update(financeMaintenanceRuns)
      .set({ stage: "reconciliation", version: 2 })
      .where(eq(financeMaintenanceRuns.id, run.id));
    const reconciled = await service.maintainFinances(
      { operation: "resume", runId: run.id },
      context,
    );
    expect(reconciled).toMatchObject({ data: { stage: "agent_audit" } });
    await service.maintainFinances(
      {
        expectedVersion: reconciled.data.version,
        findings: [],
        idempotencyKey: "settle-reconciled-maintenance",
        operation: "submit_audit",
        runId: run.id,
      },
      context,
    );
  });

  it("runs deterministic rules, creates review work, and links related transactions", async () => {
    const now = () => new Date("2026-08-25T20:00:00Z");
    const inbox = createInboxService({ db: database.db, now });
    const service = createMaintenanceService({ db: database.db, inbox, now });
    const [account] = await database.db
      .select()
      .from(financeAccounts)
      .where(eq(financeAccounts.userId, userId))
      .limit(1);
    const [category] = await database.db
      .select()
      .from(financeCategories)
      .where(eq(financeCategories.userId, userId))
      .limit(1);
    if (!account || !category) throw new Error("Maintenance fixtures missing.");
    await database.db.insert(financeCategoryRules).values({
      category: category.name,
      merchantNormalized: "known market",
      userId,
    });
    const [plan] = await database.db
      .insert(financeBudgetPlans)
      .values({ name: "Maintenance plan", userId })
      .returning();
    if (!plan) throw new Error("Maintenance plan missing.");
    await database.db.insert(financeBudgetVersions).values({
      allocatedTotal: 100000,
      assumptions: [],
      balanceDelta: 0,
      effectiveFrom: "2026-08",
      expectedResources: 100000,
      planId: plan.id,
      rationale: "Maintenance fixture.",
      resources: [{ amount: 100000, key: "income", kind: "income" }],
      status: "active",
      userId,
      version: 1,
    });
    const [deterministic, uncertain, transferOne, transferTwo] = await database.db
      .insert(financeTransactions)
      .values([
        {
          accountId: account.id,
          amount: 1000,
          direction: "expense",
          merchant: "Known Market",
          transactionDate: "2026-08-25",
          userId,
        },
        {
          accountId: account.id,
          amount: 1100,
          direction: "expense",
          merchant: "Unclear",
          transactionDate: "2026-08-25",
          userId,
        },
        {
          accountId: account.id,
          amount: 2000,
          direction: "expense",
          merchant: "Move out",
          transactionDate: "2026-08-25",
          userId,
        },
        {
          accountId: account.id,
          amount: 2000,
          direction: "income",
          merchant: "Move in",
          transactionDate: "2026-08-25",
          userId,
        },
      ])
      .returning();
    if (!deterministic || !uncertain || !transferOne || !transferTwo)
      throw new Error("Maintenance transactions missing.");
    const context = await loadFinanceAuthorization({
      db: database.db,
      principal: {
        actorId: "agent",
        actorType: "agent",
        scopes: new Set(["finances:write"]),
        userId,
      },
      requestId: "mixed-maintenance",
    });
    const started = await service.maintainFinances(
      { operation: "start", scope: { accountIds: [account.id], type: "accounts" } },
      context,
    );
    expect(started.data.reasoningBatch.map((item) => item.transactionId)).not.toContain(
      deterministic.id,
    );
    const reasoned = await service.maintainFinances(
      {
        expectedVersion: started.data.version,
        idempotencyKey: "mixed-judgments",
        judgments: [
          {
            confidence: 0.4,
            questionReason: "The merchant is ambiguous.",
            transactionId: uncertain.id,
            type: "needs_user_review",
          },
          {
            confidence: 0.99,
            rationale: "Equal opposite movements on the same date.",
            relationship: "transfer",
            transactionIds: [transferOne.id, transferTwo.id],
            type: "link_transactions",
          },
        ],
        operation: "submit_judgments",
        runId: started.data.runId,
      },
      context,
    );
    expect(reasoned).toMatchObject({ data: { stage: "agent_audit" } });
    expect(reasoned.remainingWork.count).toBeGreaterThanOrEqual(1);
    await service.maintainFinances(
      {
        expectedVersion: reasoned.data.version,
        findings: [],
        idempotencyKey: "mixed-audit",
        operation: "submit_audit",
        runId: reasoned.data.runId,
      },
      context,
    );
    const [directionAccount] = await database.db
      .insert(financeAccounts)
      .values({ institution: "Directions", name: "Directions", provider: "manual", userId })
      .returning();
    if (!directionAccount) throw new Error("Direction account missing.");
    const [income, transfer] = await database.db
      .insert(financeTransactions)
      .values([
        {
          accountId: directionAccount.id,
          amount: 3000,
          direction: "income",
          merchant: "Unknown income",
          transactionDate: "2026-08-25",
          userId,
        },
        {
          accountId: directionAccount.id,
          amount: 3000,
          direction: "transfer",
          merchant: "Unknown transfer",
          transactionDate: "2026-08-25",
          userId,
        },
      ])
      .returning();
    if (!income || !transfer) throw new Error("Direction transactions missing.");
    const directions = await service.maintainFinances(
      {
        operation: "start",
        scope: { accountIds: [directionAccount.id], type: "accounts" },
      },
      context,
    );
    const directionsReasoned = await service.maintainFinances(
      {
        expectedVersion: directions.data.version,
        idempotencyKey: "direction-judgments",
        judgments: [
          {
            confidence: 0.2,
            questionReason: "Unknown income source.",
            transactionId: income.id,
            type: "needs_user_review",
          },
          {
            confidence: 0.2,
            questionReason: "Unknown transfer destination.",
            transactionId: transfer.id,
            type: "needs_user_review",
          },
        ],
        operation: "submit_judgments",
        runId: directions.data.runId,
      },
      context,
    );
    await service.maintainFinances(
      {
        expectedVersion: directionsReasoned.data.version,
        findings: [],
        idempotencyKey: "direction-audit",
        operation: "submit_audit",
        runId: directionsReasoned.data.runId,
      },
      context,
    );
    const since = await service.maintainFinances(
      { operation: "start", scope: { from: "2026-08-25", type: "since" } },
      context,
    );
    expect(since).toMatchObject({ data: { runId: expect.any(String) } });
    await expect(
      service.maintainFinances(
        {
          expectedVersion: since.data.version,
          idempotencyKey: "existing-event-judgment",
          judgments: [
            {
              confidence: 0.2,
              questionReason: "Still needs confirmation.",
              transactionId: income.id,
              type: "needs_user_review",
            },
          ],
          operation: "submit_judgments",
          runId: since.data.runId,
        },
        context,
      ),
    ).resolves.toMatchObject({ data: { stage: "agent_audit" } });
  });
  it("atomically links full initial maintenance and settles its real setup session once", async () => {
    const fixture = await setupFixture("setup-maintenance");
    const starts = await Promise.all([
      fixture.maintenance.maintainFinances(
        { operation: "start", scope: { type: "all_outstanding" } },
        fixture.context,
      ),
      fixture.maintenance.maintainFinances(
        { operation: "start", scope: { type: "all_outstanding" } },
        fixture.context,
      ),
    ]);
    const started = starts[0];
    if (!started) throw new Error("Run missing.");
    expect(starts[1]?.data.runId).toBe(started.data.runId);
    expect(await fixture.savedSession()).toMatchObject({
      status: "initial_maintenance",
      maintenanceRunId: started.data.runId,
      version: fixture.ready.data.version + 1,
    });
    const audit = {
      operation: "submit_audit" as const,
      runId: started.data.runId,
      expectedVersion: started.data.version,
      findings: [],
      idempotencyKey: "setup-maintenance:audit",
    };
    await fixture.maintenance.maintainFinances(audit, fixture.context);
    await fixture.maintenance.maintainFinances(audit, fixture.context);
    expect(await fixture.savedSession()).toMatchObject({
      status: "settled",
      maintenanceRunId: started.data.runId,
      version: fixture.ready.data.version + 2,
    });
    await expect(
      fixture.setup.setupFinances(
        { operation: "resume", sessionId: fixture.ready.data.sessionId },
        fixture.context,
      ),
    ).resolves.toMatchObject({
      data: { stage: "settled", maintenanceRunId: started.data.runId },
      outcome: "completed",
    });
  });

  it("keeps initial setup pending for Inbox questions and settles it after answers and an explicit run resume", async () => {
    const fixture = await setupFixture("setup-inbox");
    const [account] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "Bank",
        name: "Checking",
        provider: "manual",
        userId: fixture.owner.id,
      })
      .returning();
    if (!account) throw new Error("Account missing.");
    const [transaction] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: account.id,
        amount: 4200,
        direction: "expense",
        merchant: "Unclear purchase",
        transactionDate: "2026-09-01",
        userId: fixture.owner.id,
      })
      .returning();
    if (!transaction) throw new Error("Transaction missing.");
    const started = await fixture.maintenance.maintainFinances(
      { operation: "start", scope: { type: "all_outstanding" } },
      fixture.context,
    );
    const judged = await fixture.maintenance.maintainFinances(
      {
        operation: "submit_judgments",
        runId: started.data.runId,
        expectedVersion: started.data.version,
        judgments: [
          {
            type: "needs_user_review",
            transactionId: transaction.id,
            confidence: 0.3,
            questionReason: "The purchase purpose is unclear.",
          },
        ],
        idempotencyKey: "setup-inbox:judgment",
      },
      fixture.context,
    );
    const settled = await fixture.maintenance.maintainFinances(
      {
        operation: "submit_audit",
        runId: judged.data.runId,
        expectedVersion: judged.data.version,
        findings: [],
        idempotencyKey: "setup-inbox:audit",
      },
      fixture.context,
    );
    expect(settled).toMatchObject({
      data: { stage: "settled" },
      remainingWork: { count: 1, categories: ["finance_inbox"] },
    });
    expect(await fixture.savedSession()).toMatchObject({
      status: "initial_maintenance",
      maintenanceRunId: started.data.runId,
      version: fixture.ready.data.version + 1,
    });
    await fixture.maintenance.maintainFinances(
      { operation: "resume", runId: started.data.runId },
      fixture.context,
    );
    expect((await fixture.savedSession())?.status).toBe("initial_maintenance");
    const question = (await fixture.inbox.getFinanceInbox(fixture.owner.id)).data[0];
    if (!question) throw new Error("Inbox question missing.");
    await fixture.inbox.answerFinanceReview(
      question.id,
      {
        answer: "A legitimate personal expense.",
        resolution: { type: "dismiss", rationale: "Confirmed by the person." },
        idempotencyKey: "setup-inbox:answer",
      },
      fixture.context,
    );
    expect((await fixture.savedSession())?.status).toBe("initial_maintenance");
    await fixture.maintenance.maintainFinances(
      { operation: "resume", runId: started.data.runId },
      fixture.context,
    );
    expect(await fixture.savedSession()).toMatchObject({
      status: "settled",
      version: fixture.ready.data.version + 2,
    });
  });

  it.each([
    "accounts",
    "since",
  ] as const)("does not attach or settle setup from a narrow %s run", async (type) => {
    const fixture = await setupFixture(`setup-narrow-${type}`);
    const started = await fixture.maintenance.maintainFinances(
      {
        operation: "start",
        scope:
          type === "accounts"
            ? { type, accountIds: [fixture.owner.id] }
            : { type, from: "2099-01-01" },
      },
      fixture.context,
    );
    await fixture.maintenance.maintainFinances(
      { operation: "resume", runId: started.data.runId },
      fixture.context,
    );
    await fixture.maintenance.maintainFinances(
      {
        operation: "submit_audit",
        runId: started.data.runId,
        expectedVersion: started.data.version,
        findings: [],
        idempotencyKey: `setup-narrow-${type}:audit`,
      },
      fixture.context,
    );
    expect(await fixture.savedSession()).toMatchObject({
      status: "initial_maintenance",
      maintenanceRunId: null,
      version: fixture.ready.data.version,
    });
  });
  it("links an existing full run on explicit resume without changing another owner's setup", async () => {
    const fixture = await setupFixture("setup-resume", "active");
    const other = await setupFixture("setup-other-owner");
    if (!fixture.priorRun) throw new Error("Existing run missing.");
    expect(await fixture.savedSession()).toMatchObject({
      maintenanceRunId: null,
      status: "initial_maintenance",
    });
    await expect(
      other.maintenance.maintainFinances(
        { operation: "resume", runId: fixture.priorRun.data.runId },
        other.context,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    const resumed = await fixture.maintenance.maintainFinances(
      { operation: "resume", runId: fixture.priorRun.data.runId },
      fixture.context,
    );
    await fixture.maintenance.maintainFinances(
      { operation: "resume", runId: resumed.data.runId },
      fixture.context,
    );
    expect(await fixture.savedSession()).toMatchObject({
      maintenanceRunId: resumed.data.runId,
      status: "initial_maintenance",
      version: fixture.ready.data.version + 1,
    });
    await fixture.maintenance.maintainFinances(
      {
        operation: "submit_audit",
        runId: resumed.data.runId,
        expectedVersion: resumed.data.version,
        findings: [],
        idempotencyKey: "setup-resume:audit",
      },
      fixture.context,
    );
    expect((await fixture.savedSession())?.status).toBe("settled");
    expect(await other.savedSession()).toMatchObject({
      maintenanceRunId: null,
      status: "initial_maintenance",
      version: other.ready.data.version,
    });
  });

  it("does not use an old unlinked completed run to settle a later setup session", async () => {
    const fixture = await setupFixture("setup-old-run", "settled");
    if (!fixture.priorRun) throw new Error("Old run missing.");
    await fixture.maintenance.maintainFinances(
      { operation: "resume", runId: fixture.priorRun.data.runId },
      fixture.context,
    );
    expect(await fixture.savedSession()).toMatchObject({
      maintenanceRunId: null,
      status: "initial_maintenance",
      version: fixture.ready.data.version,
    });
    const current = await fixture.maintenance.maintainFinances(
      { operation: "start", scope: { type: "all_outstanding" } },
      fixture.context,
    );
    expect(current.data.runId).not.toBe(fixture.priorRun.data.runId);
    expect(await fixture.savedSession()).toMatchObject({
      maintenanceRunId: current.data.runId,
      status: "initial_maintenance",
      version: fixture.ready.data.version + 1,
    });
  });
});
