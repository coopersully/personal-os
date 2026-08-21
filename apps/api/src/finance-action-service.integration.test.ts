import { resolve } from "node:path";
import {
  auditEvents,
  createDatabaseClient,
  domainProfiles,
  financeAccounts,
  financeAgentActionReviews,
  financeAlerts,
  financeAutomationSettings,
  financeBudgets,
  financeCategories,
  financeCategoryRules,
  financeClassificationDecisions,
  financeIncomeStreams,
  financeMerchants,
  financeProfiles,
  financeRecurringObligations,
  financeReimbursementMatches,
  financeReimbursements,
  financeTransactionAllocations,
  financeTransactions,
  goals,
  migrateDatabase,
  users,
} from "@personal-os/database";
import type { MaterialSourceReference } from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq, inArray } from "drizzle-orm";
import type { SupportedActionKind } from "./finance-action-service.js";
import { createFinanceActionService } from "./finance-action-service.js";
import { createFinanceService } from "./finance-service.js";
import type { Principal } from "./types.js";

const now = new Date("2026-08-17T12:00:00.000Z");

function agent(userId: string, actorId = "finance-agent"): Principal {
  return {
    actorId,
    actorType: "agent",
    scopes: new Set(["finances:read", "finances:write"]),
    userId,
  };
}

function user(userId: string): Principal {
  return {
    actorId: userId,
    actorType: "user",
    scopes: new Set(["finances:read", "finances:write"]),
    userId,
  };
}

async function waitForLockWaiter(
  pool: ReturnType<typeof createDatabaseClient>["pool"],
  tableName: string,
  minimum = 1,
) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM pg_stat_activity
       WHERE datname = current_database()
         AND wait_event_type = 'Lock'
         AND query LIKE $1`,
      [`%${tableName}%`],
    );
    if (Number(result.rows[0]?.count ?? 0) >= minimum) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  throw new Error(`Expected ${minimum} database lock waiter(s) for ${tableName}.`);
}

async function settleWithoutDeadlock(operations: Promise<unknown>[]) {
  const outcomes = await Promise.race([
    Promise.allSettled(operations),
    new Promise<"timed_out">((resolvePromise) =>
      setTimeout(() => resolvePromise("timed_out"), 5_000),
    ),
  ]);
  expect(outcomes).not.toBe("timed_out");
  if (outcomes === "timed_out") throw new Error("Concurrent Finance operations did not finish.");
  return outcomes;
}

async function waitForAdvisoryLockWaiters(
  pool: ReturnType<typeof createDatabaseClient>["pool"],
  minimum = 1,
) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event = 'advisory'",
    );
    if (Number(result.rows[0]?.count ?? 0) >= minimum) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  throw new Error(`Expected ${minimum} reimbursement topology lock waiter(s).`);
}

function createStatementTimedDatabase(connectionUri: string) {
  const url = new URL(connectionUri);
  // Every writer session gets a server-side ceiling as well as the test's
  // client-side completion assertion, so a reversed lock order cannot hang
  // this suite indefinitely.
  url.searchParams.set("options", "-c statement_timeout=5000");
  return createDatabaseClient(url.toString());
}

type ActionCase = {
  actionKind: SupportedActionKind;
  foreignInput: Record<string, unknown>;
  input: Record<string, unknown>;
  missingInput: Record<string, unknown>;
};

async function seedActionCases(
  database: ReturnType<typeof createDatabaseClient>,
  ownerId: string,
  label: string,
): Promise<ActionCase[]> {
  const [account] = await database.db
    .insert(financeAccounts)
    .values({
      institution: label,
      name: `${label} checking`,
      provider: "manual",
      status: "manual",
      userId: ownerId,
    })
    .returning();
  const [category] = await database.db
    .insert(financeCategories)
    .values({
      group: "Test",
      name: `${label} category`,
      slug: `${label.toLowerCase()}-${crypto.randomUUID()}`,
      userId: ownerId,
    })
    .returning();
  const [merchant] = await database.db
    .insert(financeMerchants)
    .values({
      displayName: `${label} merchant`,
      normalizedName: `${label.toLowerCase()} merchant`,
      userId: ownerId,
    })
    .returning();
  if (!account || !category || !merchant)
    throw new Error("Finance action targets were not created.");
  const [transaction] = await database.db
    .insert(financeTransactions)
    .values({
      accountId: account.id,
      amount: 1234,
      direction: "expense",
      merchant: merchant.displayName,
      merchantId: merchant.id,
      transactionDate: "2026-08-17",
      userId: ownerId,
    })
    .returning();
  const [income] = await database.db
    .insert(financeIncomeStreams)
    .values({
      cadence: "monthly",
      confidence: 9000,
      displayName: `${label} income`,
      expectedAmount: 100_000,
      amountTolerance: 0,
      payer: `${label} payer`,
      source: "user",
      status: "active",
      userId: ownerId,
    })
    .returning();
  const [recurring] = await database.db
    .insert(financeRecurringObligations)
    .values({
      cadence: "monthly",
      confidence: 9000,
      displayName: `${label} bill`,
      expectedAmount: 1000,
      amountTolerance: 0,
      kind: "bill",
      merchant: `${label} bill`,
      source: "user",
      status: "active",
      userId: ownerId,
    })
    .returning();
  if (!transaction || !income || !recurring)
    throw new Error("Finance action records were not created.");
  const [alert] = await database.db
    .insert(financeAlerts)
    .values({
      body: `${label} alert`,
      evidence: {},
      severity: "warning",
      title: `${label} alert`,
      type: "income_missing",
      userId: ownerId,
    })
    .returning();
  if (!alert) throw new Error("Finance alert was not created.");

  return [
    {
      actionKind: "profile",
      foreignInput: { payAccountId: account.id },
      input: { effectiveDate: "2026-08-17", employer: label, payAccountId: account.id },
      missingInput: { effectiveDate: 1 },
    },
    {
      actionKind: "budget_plan",
      foreignInput: {
        allocations: [{ categoryId: category.id, limit: 10 }],
        month: "2026-10",
        rationale: label,
      },
      input: {
        allocations: [{ categoryId: category.id, limit: 10 }],
        month: "2026-09",
        rationale: label,
      },
      missingInput: {},
    },
    {
      actionKind: "categorization",
      foreignInput: {
        decisions: [
          {
            categoryId: category.id,
            confidence: 1,
            expectedTransactionUpdatedAt: transaction.updatedAt.toISOString(),
            learnMerchant: "suggest",
            rationale: label,
            transactionId: transaction.id,
          },
        ],
      },
      input: {
        decisions: [
          {
            categoryId: category.id,
            confidence: 1,
            expectedTransactionUpdatedAt: transaction.updatedAt.toISOString(),
            learnMerchant: "suggest",
            rationale: label,
            transactionId: transaction.id,
          },
        ],
      },
      missingInput: { decisions: [] },
    },
    {
      actionKind: "merchant",
      foreignInput: { displayName: `${label} renamed`, id: merchant.id },
      input: { displayName: `${label} renamed`, id: merchant.id },
      missingInput: {},
    },
    {
      actionKind: "recurring_obligation",
      foreignInput: { id: recurring.id, status: "paused" },
      input: { id: recurring.id, status: "paused" },
      missingInput: {},
    },
    {
      actionKind: "alert",
      foreignInput: { action: "resolve", id: alert.id },
      input: { action: "resolve", id: alert.id },
      missingInput: {},
    },
    {
      actionKind: "transaction",
      foreignInput: { id: transaction.id, notes: label },
      input: { id: transaction.id, notes: label },
      missingInput: {},
    },
    {
      actionKind: "transaction_breakdown",
      foreignInput: {
        allocations: [{ amount: 12.34, categoryId: category.id, rationale: label }],
        expectedTransactionUpdatedAt: transaction.updatedAt.toISOString(),
        id: transaction.id,
        rationale: label,
      },
      input: {
        allocations: [{ amount: 12.34, categoryId: category.id, rationale: label }],
        expectedTransactionUpdatedAt: transaction.updatedAt.toISOString(),
        id: transaction.id,
        rationale: label,
      },
      missingInput: {},
    },
    {
      actionKind: "income_stream",
      foreignInput: { id: income.id, status: "paused" },
      input: { id: income.id, status: "paused" },
      missingInput: {},
    },
  ];
}

async function storeReimbursementQuestion(
  database: ReturnType<typeof createDatabaseClient>,
  input: {
    accountId: string;
    candidate: Record<string, unknown>;
    maintenanceAnswerAuthority?: boolean;
    requestingAgentId?: string;
    source?: MaterialSourceReference;
    transaction: typeof financeTransactions.$inferSelect;
    userId: string;
  },
) {
  const source = input.source ?? {
    accountId: input.accountId,
    provider: "local" as const,
    remoteId: input.transaction.id,
    revision: input.transaction.updatedAt.toISOString(),
    sourceType: "finance_transaction" as const,
  };
  const [stored] = await database.db
    .insert(financeAgentActionReviews)
    .values({
      actionKind: "question",
      expectedRevision: "maintenance-question",
      fingerprint: `maintenance-reimbursement-${crypto.randomUUID()}`,
      privatePayload: {
        candidate: input.candidate,
        ...(input.maintenanceAnswerAuthority === false
          ? {}
          : { maintenanceAnswerAuthority: "same_user_finances_write" }),
        original: { actionKind: "reimbursement", input: { operation: "answer_question" } },
        question: {
          actionKind: "reimbursement",
          choices: [],
          expectedAnswer: [{ name: "answer", required: true, type: "object" }],
          id: "pending",
          prompt: "Resolve reimbursement evidence.",
          sourceRefs: [source],
          why: "Maintenance needs reimbursement evidence.",
        },
      },
      requestingAgentId: input.requestingAgentId ?? "finance-maintenance",
      safeChanges: [
        { entityId: input.transaction.id, entityType: "finance_transaction", summary: "Classify." },
      ],
      semanticTargetKeys: [`transaction:${input.transaction.id}`],
      sourceRefs: [source],
      userId: input.userId,
    })
    .returning();
  if (!stored) throw new Error("Maintenance reimbursement question was not created.");
  return stored;
}

describe.sequential("finance action service", () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabaseClient>;
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
        displayName: "Finance actions",
        email: "finance-actions@example.com",
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!user) throw new Error("Finance action test user was not created.");
    userId = user.id;
  });

  afterAll(async () => {
    await database.close();
    await container.stop();
  });

  it("queues prepared agent work when durable bypass is disabled, then applies the same action after it is enabled", async () => {
    // A regression that applies before queueing would make the first assertion fail.
    await database.db
      .insert(financeAutomationSettings)
      .values({ reviewBypassEnabled: false, userId })
      .onConflictDoUpdate({
        set: { reviewBypassEnabled: false, updatedAt: now },
        target: financeAutomationSettings.userId,
      });
    const updateProfile = vi.fn(async () => ({ id: "profile-1", updatedAt: now.toISOString() }));
    const service = createFinanceActionService({
      db: database.db,
      finances: { updateProfile } as never,
      now: () => now,
    });
    const context = { principal: agent(userId), requestId: "action-queue" };
    const input = { effectiveDate: "2026-08-17", employer: "Ilo", payFrequency: "monthly" };

    await expect(service.performDirect("profile", input, context)).resolves.toMatchObject({
      status: "pending_review",
      review: { actionKind: "profile", status: "pending" },
    });
    expect(updateProfile).not.toHaveBeenCalled();
    await expect(
      database.db
        .select({ status: financeAgentActionReviews.status })
        .from(financeAgentActionReviews)
        .where(eq(financeAgentActionReviews.userId, userId)),
    ).resolves.toEqual([{ status: "pending" }]);

    await database.db
      .update(financeAutomationSettings)
      .set({ reviewBypassEnabled: true, updatedAt: now })
      .where(eq(financeAutomationSettings.userId, userId));
    await expect(service.performDirect("profile", input, context)).resolves.toMatchObject({
      result: { id: "profile-1" },
      status: "applied",
    });
    expect(updateProfile).toHaveBeenCalledOnce();
  });

  it("prepares reimbursement evidence before bypass and keeps its semantic write in the action transaction", async () => {
    const [account] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "Reimbursement",
        name: "checking",
        provider: "manual",
        status: "manual",
        userId,
      })
      .returning();
    const [category] = await database.db
      .insert(financeCategories)
      .values({
        group: "Test",
        name: "Reimbursement dining",
        slug: `reimbursement-${crypto.randomUUID()}`,
        userId,
      })
      .returning();
    if (!account || !category) throw new Error("Reimbursement action fixture failed.");
    const [expense] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: account.id,
        amount: 22_000,
        direction: "expense",
        merchant: "Dinner",
        transactionDate: "2026-08-17",
        userId,
      })
      .returning();
    if (!expense) throw new Error("Reimbursement expense fixture failed.");
    const [allocation] = await database.db
      .insert(financeTransactionAllocations)
      .values({
        allocationOrder: 0,
        amount: 22_000,
        categoryId: category.id,
        rationale: "split",
        transactionId: expense.id,
        treatment: "reimbursable",
        userId,
      })
      .returning();
    if (!allocation) throw new Error("Reimbursement allocation fixture failed.");
    const finances = createFinanceService({ db: database.db, now: () => now });
    const actions = createFinanceActionService({ db: database.db, finances, now: () => now });
    const input = {
      allocationId: allocation.id,
      dueDate: "2026-08-20",
      evidence: {
        sourceRefs: [
          {
            accountId: null,
            provider: "local",
            remoteId: "receipt",
            revision: null,
            sourceType: "local",
          },
        ],
        summary: "Receipt attached",
      },
      expectedAmount: 220,
      operation: "create",
      payer: "Alex",
      rationale: "Alex agreed to repay this share",
    } as const;
    await database.db
      .insert(financeAutomationSettings)
      .values({ reviewBypassEnabled: false, userId })
      .onConflictDoUpdate({
        set: { reviewBypassEnabled: false, updatedAt: now },
        target: financeAutomationSettings.userId,
      });
    const queued = await actions.performDirect("reimbursement", input, {
      principal: agent(userId),
      requestId: "reimbursement-queue",
    });
    if (queued.status !== "pending_review") throw new Error("Expected reimbursement review.");
    await expect(
      database.db
        .select()
        .from(financeReimbursements)
        .where(eq(financeReimbursements.allocationId, allocation.id)),
    ).resolves.toHaveLength(0);
    await database.pool.query(`
      CREATE OR REPLACE FUNCTION fail_reimbursement_review_terminalization() RETURNS trigger AS $$
      BEGIN
        IF NEW.status = 'applied' THEN RAISE EXCEPTION 'forced reimbursement terminalization failure'; END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_reimbursement_review_terminalization
      BEFORE UPDATE ON finance_agent_action_reviews
      FOR EACH ROW EXECUTE FUNCTION fail_reimbursement_review_terminalization();
    `);
    try {
      await expect(
        actions.approve(queued.review.id, {
          principal: user(userId),
          requestId: "reimbursement-fail",
        }),
      ).rejects.toThrow(/finance_agent_action_reviews/);
    } finally {
      await database.pool.query(
        "DROP TRIGGER fail_reimbursement_review_terminalization ON finance_agent_action_reviews",
      );
      await database.pool.query("DROP FUNCTION fail_reimbursement_review_terminalization()");
    }
    await expect(
      database.db
        .select()
        .from(financeReimbursements)
        .where(eq(financeReimbursements.allocationId, allocation.id)),
    ).resolves.toHaveLength(0);
    await expect(
      actions.approve(queued.review.id, {
        principal: user(userId),
        requestId: "reimbursement-approve",
      }),
    ).resolves.toMatchObject({ result: { status: "expected" }, status: "applied" });
    await database.db
      .update(financeAutomationSettings)
      .set({ reviewBypassEnabled: true, updatedAt: now })
      .where(eq(financeAutomationSettings.userId, userId));
    const appliedReimbursement = await actions.performDirect("reimbursement", input, {
      principal: agent(userId),
      requestId: "reimbursement-apply",
    });
    expect(appliedReimbursement).toMatchObject({
      result: { status: "expected" },
      status: "applied",
    });
    await expect(
      actions.performDirect("reimbursement", input, {
        principal: agent(userId),
        requestId: "reimbursement-replay",
      }),
    ).resolves.toMatchObject({ result: { status: "expected" }, status: "applied" });
    await expect(
      database.db
        .select()
        .from(financeReimbursements)
        .where(eq(financeReimbursements.allocationId, allocation.id)),
    ).resolves.toHaveLength(1);
    await expect(
      actions.performDirect(
        "reimbursement",
        { ...input, evidence: {} },
        { principal: agent(userId), requestId: "reimbursement-missing" },
      ),
    ).resolves.toMatchObject({ status: "needs_input" });
  });

  it("returns a question before consulting bypass when a categorization lacks evidence", async () => {
    // A regression that uses bypass as permission to invent a category would apply this action.
    const getAutomationSettings = vi.fn();
    const service = createFinanceActionService({
      db: database.db,
      finances: { getAutomationSettings } as never,
      now: () => now,
    });

    await expect(
      service.performDirect(
        "categorization",
        { decisions: [] },
        {
          principal: agent(userId),
          requestId: "missing-evidence",
        },
      ),
    ).resolves.toMatchObject({
      question: { actionKind: "categorization" },
      status: "needs_input",
    });
    expect(getAutomationSettings).not.toHaveBeenCalled();
  });

  it("locks a pending review so repeated human approval applies its prepared action once", async () => {
    // A regression that replays an applied review would call updateProfile twice.
    await database.db
      .update(financeAutomationSettings)
      .set({ reviewBypassEnabled: false, updatedAt: now })
      .where(eq(financeAutomationSettings.userId, userId));
    const updateProfile = vi.fn(async () => ({ id: "profile-approved" }));
    const service = createFinanceActionService({
      db: database.db,
      finances: { updateProfile } as never,
      now: () => now,
    });
    const input = {
      effectiveDate: "2026-08-18",
      employer: "Ilo",
      payFrequency: "monthly",
    };
    const queued = await service.performDirect("profile", input, {
      principal: agent(userId),
      requestId: "approval-queue",
    });
    if (queued.status !== "pending_review") throw new Error("Expected a pending Finance review.");
    const approvalContext = { principal: user(userId), requestId: "approval" };

    await expect(service.approve(queued.review.id, approvalContext)).resolves.toMatchObject({
      result: { id: "profile-approved" },
      status: "applied",
    });
    await expect(service.approve(queued.review.id, approvalContext)).resolves.toMatchObject({
      result: { id: "profile-approved" },
      status: "applied",
    });
    expect(updateProfile).toHaveBeenCalledOnce();
  });

  it("audits human approval once without attributing bypass application to the approver", async () => {
    const updateProfile = vi.fn(async () => ({ id: "approved-profile" }));
    const service = createFinanceActionService({
      db: database.db,
      finances: { updateProfile } as never,
      now: () => now,
    });
    await database.db
      .update(financeAutomationSettings)
      .set({ reviewBypassEnabled: true, updatedAt: now })
      .where(eq(financeAutomationSettings.userId, userId));
    await expect(
      service.performDirect(
        "profile",
        { effectiveDate: "2026-12-10", employer: "Bypass profile" },
        { principal: agent(userId), requestId: "approval-audit-bypass" },
      ),
    ).resolves.toMatchObject({ status: "applied" });
    await expect(
      database.db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(eq(auditEvents.requestId, "approval-audit-bypass")),
    ).resolves.toEqual([]);

    await database.db
      .update(financeAutomationSettings)
      .set({ reviewBypassEnabled: false, updatedAt: now })
      .where(eq(financeAutomationSettings.userId, userId));
    const queued = await service.performDirect(
      "profile",
      { effectiveDate: "2026-12-11", employer: "Approved profile" },
      { principal: agent(userId), requestId: "approval-audit-queue" },
    );
    if (queued.status !== "pending_review") throw new Error("Expected a pending Finance review.");
    await expect(
      service.approve(queued.review.id, {
        principal: user(userId),
        requestId: "approval-audit-approve",
      }),
    ).resolves.toMatchObject({ status: "applied" });
    await expect(
      database.db
        .select({
          action: auditEvents.action,
          after: auditEvents.after,
          actorId: auditEvents.actorId,
          actorType: auditEvents.actorType,
          requestId: auditEvents.requestId,
        })
        .from(auditEvents)
        .where(eq(auditEvents.entityId, queued.review.id)),
    ).resolves.toContainEqual({
      action: "finance.action_review_approved",
      after: {
        actionKind: "profile",
        fingerprint: queued.review.fingerprint,
        reviewId: queued.review.id,
      },
      actorId: userId,
      actorType: "user",
      requestId: "approval-audit-approve",
    });
    await expect(
      service.approve(queued.review.id, {
        principal: user(userId),
        requestId: "approval-audit-replay",
      }),
    ).resolves.toMatchObject({ status: "applied" });
    await expect(
      database.db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(eq(auditEvents.entityId, queued.review.id)),
    ).resolves.toHaveLength(1);

    const rollback = await service.performDirect(
      "profile",
      { effectiveDate: "2026-12-12", employer: "Rollback profile" },
      { principal: agent(userId), requestId: "approval-audit-rollback-queue" },
    );
    if (rollback.status !== "pending_review") throw new Error("Expected a pending Finance review.");
    await database.pool.query(`
      CREATE OR REPLACE FUNCTION fail_finance_action_approval_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW.status = 'applied' THEN RAISE EXCEPTION 'forced action approval failure'; END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_finance_action_approval_audit
      BEFORE UPDATE ON finance_agent_action_reviews
      FOR EACH ROW EXECUTE FUNCTION fail_finance_action_approval_audit();
    `);
    try {
      await expect(
        service.approve(rollback.review.id, {
          principal: user(userId),
          requestId: "approval-audit-rollback-approve",
        }),
      ).rejects.toThrow(/finance_agent_action_reviews/);
    } finally {
      await database.pool.query(
        "DROP TRIGGER fail_finance_action_approval_audit ON finance_agent_action_reviews",
      );
      await database.pool.query("DROP FUNCTION fail_finance_action_approval_audit()");
    }
    await expect(
      database.db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(eq(auditEvents.entityId, rollback.review.id)),
    ).resolves.toEqual([]);
  });

  it("holds the bypass settings lock until a bypassed agent action is applied", async () => {
    await database.db
      .update(financeAutomationSettings)
      .set({ reviewBypassEnabled: true, updatedAt: now })
      .where(eq(financeAutomationSettings.userId, userId));
    let writerStarted!: () => void;
    let releaseWriter!: () => void;
    const started = new Promise<void>((resolve) => {
      writerStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseWriter = resolve;
    });
    const updateProfile = vi.fn(async () => {
      writerStarted();
      await release;
      return { id: "profile-locked" };
    });
    const service = createFinanceActionService({
      db: database.db,
      finances: { updateProfile } as never,
      now: () => now,
    });

    const applying = service.performDirect(
      "profile",
      { effectiveDate: "2026-08-18", employer: "Ilo", payFrequency: "monthly" },
      { principal: agent(userId), requestId: "bypass-lock" },
    );
    await started;
    const disabling = database.db
      .update(financeAutomationSettings)
      .set({ reviewBypassEnabled: false, updatedAt: now })
      .where(eq(financeAutomationSettings.userId, userId));
    const disabledBeforeApply = await Promise.race([
      disabling.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100)),
    ]);
    expect(disabledBeforeApply).toBe(false);

    releaseWriter();
    await expect(applying).resolves.toMatchObject({
      result: { id: "profile-locked" },
      status: "applied",
    });
    await disabling;
    expect(updateProfile).toHaveBeenCalledOnce();
  });

  it("rolls back a writer and retains the pending review when an approval writer fails", async () => {
    // Without the approval transaction being passed to the writer, this fails
    // with a missing executor before the injected failure and cannot prove the
    // writer/review rollback boundary.
    await database.db
      .update(financeAutomationSettings)
      .set({ reviewBypassEnabled: false, updatedAt: now })
      .where(eq(financeAutomationSettings.userId, userId));
    const updateProfile = vi.fn(async (_input, _context, executor) => {
      await executor.insert(financeProfiles).values({
        effectiveDate: "2026-08-19",
        employer: "Rolled back",
        payFrequency: "monthly",
        userId,
      });
      throw new Error("forced profile failure");
    });
    const service = createFinanceActionService({
      db: database.db,
      finances: { updateProfile } as never,
      now: () => now,
    });
    const queued = await service.performDirect(
      "profile",
      { effectiveDate: "2026-08-19", employer: "Ilo", payFrequency: "monthly" },
      { principal: agent(userId), requestId: "rollback-queue" },
    );
    if (queued.status !== "pending_review") throw new Error("Expected a pending Finance review.");

    await expect(
      service.approve(queued.review.id, { principal: user(userId), requestId: "rollback" }),
    ).rejects.toThrow("forced profile failure");
    await expect(
      database.db
        .select({ employer: financeProfiles.employer })
        .from(financeProfiles)
        .where(eq(financeProfiles.effectiveDate, "2026-08-19")),
    ).resolves.toEqual([]);
    await expect(
      database.db
        .select({ status: financeAgentActionReviews.status })
        .from(financeAgentActionReviews)
        .where(eq(financeAgentActionReviews.id, queued.review.id)),
    ).resolves.toEqual([{ status: "pending" }]);
  });

  it("rolls back a real transaction update when terminal review persistence fails", async () => {
    // A root-db writer would commit this update before the outer review status
    // trigger fails. The action writer must share the approval transaction.
    const [account] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "Action test bank",
        name: "Action checking",
        provider: "manual",
        status: "manual",
        userId,
      })
      .returning();
    if (!account) throw new Error("Action test account was not created.");
    const [transaction] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: account.id,
        amount: 1250,
        direction: "expense",
        merchant: "Atomic test merchant",
        notes: "before approval",
        transactionDate: "2026-08-20",
        userId,
      })
      .returning();
    if (!transaction) throw new Error("Action test transaction was not created.");
    const finances = createFinanceService({ db: database.db, now: () => now });
    const service = createFinanceActionService({ db: database.db, finances, now: () => now });
    const queued = await service.performDirect(
      "transaction",
      { id: transaction.id, notes: "must roll back" },
      { principal: agent(userId), requestId: "terminal-rollback-queue" },
    );
    if (queued.status !== "pending_review") throw new Error("Expected a pending Finance review.");
    await database.pool.query(`
      CREATE OR REPLACE FUNCTION fail_finance_action_terminalization() RETURNS trigger AS $$
      BEGIN
        IF NEW.status = 'applied' THEN RAISE EXCEPTION 'forced terminal failure'; END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_finance_action_terminalization
      BEFORE UPDATE ON finance_agent_action_reviews
      FOR EACH ROW EXECUTE FUNCTION fail_finance_action_terminalization();
    `);

    await expect(
      service.approve(queued.review.id, {
        principal: user(userId),
        requestId: "terminal-rollback",
      }),
    ).rejects.toThrow(/finance_agent_action_reviews/);
    await database.pool.query(
      "DROP TRIGGER fail_finance_action_terminalization ON finance_agent_action_reviews",
    );
    await database.pool.query("DROP FUNCTION fail_finance_action_terminalization()");
    await expect(
      database.db
        .select({ notes: financeTransactions.notes })
        .from(financeTransactions)
        .where(eq(financeTransactions.id, transaction.id)),
    ).resolves.toEqual([{ notes: "before approval" }]);
    await expect(
      database.db
        .select({ status: financeAgentActionReviews.status })
        .from(financeAgentActionReviews)
        .where(eq(financeAgentActionReviews.id, queued.review.id)),
    ).resolves.toEqual([{ status: "pending" }]);
  });

  it("rolls back a real profile update when terminal review persistence fails", async () => {
    const finances = createFinanceService({ db: database.db, now: () => now });
    const service = createFinanceActionService({ db: database.db, finances, now: () => now });
    const queued = await service.performDirect(
      "profile",
      {
        effectiveDate: "2026-08-21",
        employer: "Atomic profile",
        employmentType: null,
        expectedNetPay: null,
        grossAnnualIncome: null,
        nextPayday: null,
        payAccountId: null,
        payFrequency: "monthly",
        role: null,
      },
      { principal: agent(userId), requestId: "profile-terminal-rollback-queue" },
    );
    if (queued.status !== "pending_review") throw new Error("Expected a pending Finance review.");
    await database.pool.query(`
      CREATE OR REPLACE FUNCTION fail_finance_profile_terminalization() RETURNS trigger AS $$
      BEGIN
        IF NEW.status = 'applied' THEN RAISE EXCEPTION 'forced profile terminal failure'; END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_finance_profile_terminalization
      BEFORE UPDATE ON finance_agent_action_reviews
      FOR EACH ROW EXECUTE FUNCTION fail_finance_profile_terminalization();
    `);

    await expect(
      service.approve(queued.review.id, {
        principal: user(userId),
        requestId: "profile-terminal-rollback",
      }),
    ).rejects.toThrow(/finance_agent_action_reviews/);
    await database.pool.query(
      "DROP TRIGGER fail_finance_profile_terminalization ON finance_agent_action_reviews",
    );
    await database.pool.query("DROP FUNCTION fail_finance_profile_terminalization()");
    await expect(
      database.db
        .select({ employer: financeProfiles.employer })
        .from(financeProfiles)
        .where(eq(financeProfiles.effectiveDate, "2026-08-21")),
    ).resolves.toEqual([]);
    await expect(
      database.db
        .select({ status: financeAgentActionReviews.status })
        .from(financeAgentActionReviews)
        .where(eq(financeAgentActionReviews.id, queued.review.id)),
    ).resolves.toEqual([{ status: "pending" }]);
  });

  it("audits approved refreshes redactively and rolls the audit back when review terminalization fails", async () => {
    await database.db
      .insert(financeAutomationSettings)
      .values({ reviewBypassEnabled: false, userId })
      .onConflictDoUpdate({
        set: { reviewBypassEnabled: false, updatedAt: now },
        target: financeAutomationSettings.userId,
      });
    const service = createFinanceActionService({
      db: database.db,
      finances: createFinanceService({ db: database.db, now: () => now }),
      now: () => now,
    });
    const queued = await service.performDirect(
      "alert",
      { operation: "refresh" },
      { principal: agent(userId), requestId: "refresh-audit-queue" },
    );
    if (queued.status !== "pending_review") throw new Error("Expected a pending refresh review.");

    await expect(
      service.approve(queued.review.id, {
        principal: user(userId),
        requestId: "refresh-audit-approve",
      }),
    ).resolves.toMatchObject({ result: { refreshed: true }, status: "applied" });
    await expect(
      database.db
        .select({
          action: auditEvents.action,
          actorId: auditEvents.actorId,
          actorType: auditEvents.actorType,
          after: auditEvents.after,
          before: auditEvents.before,
          entityId: auditEvents.entityId,
          entityType: auditEvents.entityType,
          requestId: auditEvents.requestId,
        })
        .from(auditEvents)
        .where(eq(auditEvents.requestId, "refresh-audit-approve")),
    ).resolves.toEqual([
      {
        action: "finance.insights_refreshed",
        actorId: userId,
        actorType: "user",
        after: { refreshed: true },
        before: null,
        entityId: userId,
        entityType: "finance_alert",
        requestId: "refresh-audit-approve",
      },
      {
        action: "finance.action_review_approved",
        actorId: userId,
        actorType: "user",
        after: {
          actionKind: "alert",
          fingerprint: queued.review.fingerprint,
          reviewId: queued.review.id,
        },
        before: null,
        entityId: queued.review.id,
        entityType: "finance_agent_action_review",
        requestId: "refresh-audit-approve",
      },
    ]);

    const queuedForRollback = await service.performDirect(
      "alert",
      { operation: "refresh" },
      { principal: agent(userId), requestId: "refresh-terminal-rollback-queue" },
    );
    if (queuedForRollback.status !== "pending_review")
      throw new Error("Expected a pending refresh review.");
    await database.pool.query(`
      CREATE OR REPLACE FUNCTION fail_finance_refresh_terminalization() RETURNS trigger AS $$
      BEGIN
        IF NEW.status = 'applied' THEN RAISE EXCEPTION 'forced refresh terminal failure'; END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_finance_refresh_terminalization
      BEFORE UPDATE ON finance_agent_action_reviews
      FOR EACH ROW EXECUTE FUNCTION fail_finance_refresh_terminalization();
    `);
    try {
      await expect(
        service.approve(queuedForRollback.review.id, {
          principal: user(userId),
          requestId: "refresh-terminal-rollback-approve",
        }),
      ).rejects.toThrow(/finance_agent_action_reviews/);
    } finally {
      await database.pool.query(
        "DROP TRIGGER fail_finance_refresh_terminalization ON finance_agent_action_reviews",
      );
      await database.pool.query("DROP FUNCTION fail_finance_refresh_terminalization()");
    }
    await expect(
      database.db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(eq(auditEvents.requestId, "refresh-terminal-rollback-approve")),
    ).resolves.toEqual([]);
    await expect(
      database.db
        .select({ status: financeAgentActionReviews.status })
        .from(financeAgentActionReviews)
        .where(eq(financeAgentActionReviews.id, queuedForRollback.review.id)),
    ).resolves.toEqual([{ status: "pending" }]);
  });

  it("supersedes a stale prepared transaction instead of applying it on approval", async () => {
    await database.db
      .update(financeAutomationSettings)
      .set({ reviewBypassEnabled: false, updatedAt: now })
      .where(eq(financeAutomationSettings.userId, userId));
    const [account] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "Stale test bank",
        name: "Stale checking",
        provider: "manual",
        status: "manual",
        userId,
      })
      .returning();
    if (!account) throw new Error("Stale test account was not created.");
    const [transaction] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: account.id,
        amount: 2_500,
        direction: "expense",
        merchant: "Stale merchant",
        notes: "before",
        transactionDate: "2026-08-22",
        userId,
      })
      .returning();
    if (!transaction) throw new Error("Stale test transaction was not created.");
    const updateTransaction = vi.fn(async () => ({ id: transaction.id }));
    const service = createFinanceActionService({
      db: database.db,
      finances: { updateTransaction } as never,
      now: () => now,
    });
    const queued = await service.performDirect(
      "transaction",
      { id: transaction.id, notes: "prepared edit" },
      { principal: agent(userId), requestId: "stale-queue" },
    );
    if (queued.status !== "pending_review") throw new Error("Expected a pending Finance review.");
    await database.db
      .update(financeTransactions)
      .set({ notes: "changed elsewhere", updatedAt: new Date("2026-08-17T12:01:00.000Z") })
      .where(eq(financeTransactions.id, transaction.id));

    await expect(
      service.approve(queued.review.id, { principal: user(userId), requestId: "stale-approve" }),
    ).resolves.toMatchObject({ status: "needs_input" });
    expect(updateTransaction).not.toHaveBeenCalled();
    await expect(
      database.db
        .select({ status: financeAgentActionReviews.status })
        .from(financeAgentActionReviews)
        .where(eq(financeAgentActionReviews.id, queued.review.id)),
    ).resolves.toEqual([{ status: "superseded" }]);
  });

  it("holds prepared target locks so a concurrent human edit cannot be overwritten by approval", async () => {
    const [account] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "Approval lock bank",
        name: "Approval lock checking",
        provider: "manual",
        status: "manual",
        userId,
      })
      .returning();
    if (!account) throw new Error("Approval-lock account was not created.");
    const [transaction] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: account.id,
        amount: 500,
        direction: "expense",
        merchant: "Approval lock merchant",
        notes: "before",
        transactionDate: "2026-08-23",
        userId,
      })
      .returning();
    if (!transaction) throw new Error("Approval-lock transaction was not created.");

    let startWriter!: () => void;
    const writerStarted = new Promise<void>((resolve) => {
      startWriter = resolve;
    });
    let releaseWriter!: () => void;
    const writerReleased = new Promise<void>((resolve) => {
      releaseWriter = resolve;
    });
    const updateTransaction = vi.fn(async (_id, _input, _context, executor) => {
      startWriter();
      await writerReleased;
      await executor
        .update(financeTransactions)
        .set({ notes: "approved change" })
        .where(eq(financeTransactions.id, transaction.id));
      return { id: transaction.id };
    });
    const service = createFinanceActionService({
      db: database.db,
      finances: { updateTransaction } as never,
      now: () => now,
    });
    const queued = await service.performDirect(
      "transaction",
      { id: transaction.id, notes: "approved change" },
      { principal: agent(userId), requestId: "approval-lock-queue" },
    );
    if (queued.status !== "pending_review") throw new Error("Expected a pending Finance review.");

    const approval = service.approve(queued.review.id, {
      principal: user(userId),
      requestId: "approval-lock",
    });
    await writerStarted;
    const humanEdit = database.db
      .update(financeTransactions)
      .set({ notes: "human edit" })
      .where(eq(financeTransactions.id, transaction.id));
    const humanEditFinishedDuringApproval = await Promise.race([
      humanEdit.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100)),
    ]);
    expect(humanEditFinishedDuringApproval).toBe(false);

    releaseWriter();
    await approval;
    await humanEdit;
    await expect(
      database.db
        .select({ notes: financeTransactions.notes })
        .from(financeTransactions)
        .where(eq(financeTransactions.id, transaction.id)),
    ).resolves.toEqual([{ notes: "human edit" }]);
  });

  it("orders account locks before pending transaction approval locks during account deletion", async () => {
    await database.db
      .update(financeAutomationSettings)
      .set({ reviewBypassEnabled: false, updatedAt: now })
      .where(eq(financeAutomationSettings.userId, userId));
    const [account] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "Delete lock-order bank",
        name: "Delete lock-order checking",
        provider: "manual",
        status: "manual",
        userId,
      })
      .returning();
    if (!account) throw new Error("Delete lock-order account was not created.");
    const [transaction] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: account.id,
        amount: 500,
        direction: "expense",
        merchant: "Delete lock-order merchant",
        notes: "before",
        transactionDate: "2026-08-24",
        userId,
      })
      .returning();
    const [profile] = await database.db
      .insert(domainProfiles)
      .values({
        categories: [],
        domain: "finances",
        instructions: [],
        objective: "Keep account deletion ordered.",
        preferences: {},
        sourceContexts: [],
        summary: "A test-only deletion lock barrier.",
        userId,
      })
      .returning();
    if (!transaction || !profile) throw new Error("Delete lock-order fixtures were not created.");

    const finances = createFinanceService({ db: database.db, now: () => now });
    const actions = createFinanceActionService({ db: database.db, finances, now: () => now });
    const queued = await actions.performDirect(
      "transaction",
      { id: transaction.id, notes: "approved change" },
      { principal: agent(userId), requestId: "delete-lock-order-queue" },
    );
    if (queued.status !== "pending_review") throw new Error("Expected a pending Finance review.");

    const profileBlocker = await database.pool.connect();
    try {
      await profileBlocker.query("BEGIN");
      await profileBlocker.query("SET LOCAL statement_timeout = '5s'");
      await profileBlocker.query("SELECT id FROM domain_profiles WHERE id = $1 FOR UPDATE", [
        profile.id,
      ]);
      const deletion = finances.deleteAccount(account.id, {
        principal: user(userId),
        requestId: "delete-lock-order-delete",
      });
      await waitForLockWaiter(database.pool, "domain_profiles");
      const approval = actions.approve(queued.review.id, {
        principal: user(userId),
        requestId: "delete-lock-order-approve",
      });
      await waitForLockWaiter(database.pool, "finance_accounts");

      await profileBlocker.query("COMMIT");
      const outcomes = await Promise.race([
        Promise.allSettled([deletion, approval]),
        new Promise<"timed_out">((resolvePromise) =>
          setTimeout(() => resolvePromise("timed_out"), 5_000),
        ),
      ]);
      expect(outcomes).not.toBe("timed_out");
      if (outcomes === "timed_out")
        throw new Error("Account deletion and approval did not finish.");
      expect(outcomes).toEqual([
        expect.objectContaining({ status: "fulfilled" }),
        expect.objectContaining({ status: "fulfilled" }),
      ]);
      await expect(
        database.db
          .select({ id: financeAccounts.id })
          .from(financeAccounts)
          .where(eq(financeAccounts.id, account.id)),
      ).resolves.toEqual([]);
      await expect(
        database.db
          .select({ id: financeTransactions.id })
          .from(financeTransactions)
          .where(eq(financeTransactions.id, transaction.id)),
      ).resolves.toEqual([]);
    } finally {
      await profileBlocker.query("ROLLBACK").catch(() => undefined);
      profileBlocker.release();
    }
  });

  it("describes the public answer fields for every supported action family", async () => {
    const service = createFinanceActionService({
      db: database.db,
      finances: {} as never,
      now: () => now,
    });
    const context = { principal: agent(userId), requestId: "action-question-descriptors" };
    const cases = [
      ["profile", { effectiveDate: 42 }, "effectiveDate"],
      ["budget_plan", {}, "category"],
      ["categorization", {}, "decisions"],
      ["merchant", {}, "displayName"],
      ["recurring_obligation", {}, "id"],
      ["alert", {}, "action"],
      ["transaction", {}, "id"],
      ["transaction_breakdown", {}, "id"],
      ["income_stream", {}, "id"],
    ] as const;

    for (const [actionKind, input, expectedField] of cases) {
      const outcome = await service.performDirect(actionKind, input, context);
      if (outcome.status !== "needs_input") throw new Error("Expected a Finance question.");
      expect(outcome.question.actionKind).toBe(actionKind);
      expect(outcome.question.expectedAnswer).toContainEqual(
        expect.objectContaining({ name: expectedField, required: true }),
      );
      expect(outcome.question).not.toHaveProperty("privatePayload");
    }
  });

  it("disposes every Finance action family safely across bypass, evidence, and ownership states", async () => {
    const service = createFinanceActionService({
      db: database.db,
      finances: {
        applyCategorizations: vi.fn(async () => []),
        resolveAlert: vi.fn(async () => ({})),
        setBudgetPlan: vi.fn(async () => ({})),
        setTransactionBreakdown: vi.fn(async () => ({})),
        updateIncomeStream: vi.fn(async () => ({})),
        updateMerchant: vi.fn(async () => ({})),
        updateProfile: vi.fn(async () => ({})),
        updateRecurringObligation: vi.fn(async () => ({})),
        updateTransaction: vi.fn(async () => ({})),
        validatePreparedCategorizations: vi.fn(async () => true),
      } as never,
      now: () => now,
    });
    const context = { principal: agent(userId), requestId: "action-disposition-matrix" };
    const updateBypass = async (enabled: boolean) => {
      await database.db
        .insert(financeAutomationSettings)
        .values({ reviewBypassEnabled: enabled, userId })
        .onConflictDoUpdate({
          set: { reviewBypassEnabled: enabled, updatedAt: now },
          target: financeAutomationSettings.userId,
        });
    };

    await updateBypass(true);
    for (const item of await seedActionCases(database, userId, `Applied ${crypto.randomUUID()}`)) {
      const outcome = await service.performDirect(item.actionKind, item.input, context);
      expect(outcome.status).toBe("applied");
    }

    await updateBypass(false);
    for (const item of await seedActionCases(database, userId, `Queued ${crypto.randomUUID()}`)) {
      const outcome = await service.performDirect(item.actionKind, item.input, context);
      if (outcome.status !== "pending_review")
        throw new Error("Expected a pending Finance review.");
      expect(outcome.review.actionKind).toBe(item.actionKind);
      expect(outcome.review.status).toBe("pending");
      expect(outcome.review.expectedRevision?.length ?? 0).toBeLessThanOrEqual(128);
      expect(outcome.review.changes).toContainEqual(
        expect.objectContaining({ entityType: expect.stringContaining("finance_") }),
      );
      expect(outcome.review.sourceRefs).toContainEqual(
        expect.objectContaining({ provider: expect.any(String) }),
      );
      expect(outcome.review).not.toHaveProperty("privatePayload");
    }

    for (const bypass of [false, true]) {
      await updateBypass(bypass);
      for (const item of await seedActionCases(
        database,
        userId,
        `Missing ${bypass} ${crypto.randomUUID()}`,
      )) {
        await expect(
          service.performDirect(item.actionKind, item.missingInput, context),
        ).resolves.toMatchObject({
          question: { actionKind: item.actionKind },
          status: "needs_input",
        });
      }
    }

    const [foreignUser] = await database.db
      .insert(users)
      .values({
        displayName: "Foreign Finance",
        email: `foreign-${crypto.randomUUID()}@example.com`,
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!foreignUser) throw new Error("Foreign Finance user was not created.");
    await updateBypass(true);
    for (const item of await seedActionCases(
      database,
      foreignUser.id,
      `Foreign ${crypto.randomUUID()}`,
    )) {
      await expect(
        service.performDirect(item.actionKind, item.foreignInput, context),
      ).resolves.toMatchObject({
        question: { actionKind: item.actionKind },
        status: "needs_input",
      });
    }
  });

  it("validates transaction breakdowns before bypass or queueing and recovers a corrected allocation once", async () => {
    const setTransactionBreakdown = vi.fn(async () => ({}));
    const service = createFinanceActionService({
      db: database.db,
      finances: { setTransactionBreakdown } as never,
      now: () => now,
    });
    const updateBypass = async (enabled: boolean) => {
      await database.db
        .insert(financeAutomationSettings)
        .values({ reviewBypassEnabled: enabled, userId })
        .onConflictDoUpdate({
          set: { reviewBypassEnabled: enabled, updatedAt: now },
          target: financeAutomationSettings.userId,
        });
    };
    const breakdown = (
      await seedActionCases(database, userId, `Breakdown validation ${crypto.randomUUID()}`)
    ).find((item) => item.actionKind === "transaction_breakdown");
    if (!breakdown) throw new Error("Breakdown fixture was not created.");
    const context = { principal: agent(userId), requestId: "breakdown-validation" };

    await updateBypass(false);
    const queued = await service.performDirect("transaction_breakdown", breakdown.input, context);
    if (queued.status !== "pending_review") throw new Error("Expected a pending breakdown review.");
    expect(queued.review.sourceRefs).toContainEqual(
      expect.objectContaining({ provider: "local", sourceType: "finance_transaction" }),
    );

    await updateBypass(true);
    await expect(
      service.approve(queued.review.id, {
        principal: user(userId),
        requestId: "breakdown-validation-approve",
      }),
    ).resolves.toMatchObject({ status: "applied" });

    const invalidSum = {
      ...breakdown.input,
      allocations: [
        {
          amount: 1,
          categoryId: (breakdown.input.allocations as Array<{ categoryId: string }>)[0]?.categoryId,
          rationale: "wrong sum",
        },
      ],
    };
    await expect(
      service.performDirect("transaction_breakdown", invalidSum, context),
    ).resolves.toMatchObject({
      status: "needs_input",
      question: { expectedAnswer: [expect.objectContaining({ name: "allocations" })] },
    });
    await expect(
      service.performDirect(
        "transaction_breakdown",
        { ...breakdown.input, expectedTransactionUpdatedAt: "2020-01-01T00:00:00.000Z" },
        context,
      ),
    ).resolves.toMatchObject({
      status: "needs_input",
      question: {
        expectedAnswer: [expect.objectContaining({ name: "expectedTransactionUpdatedAt" })],
      },
    });
    const [foreignOwner] = await database.db
      .insert(users)
      .values({
        displayName: "Foreign breakdown category owner",
        email: `foreign-breakdown-category-${crypto.randomUUID()}@example.com`,
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!foreignOwner) throw new Error("Foreign breakdown category owner was not created.");
    const [foreignCategory] = await database.db
      .insert(financeCategories)
      .values({
        group: "Test",
        name: "Foreign breakdown category",
        slug: `foreign-breakdown-${crypto.randomUUID()}`,
        userId: foreignOwner.id,
      })
      .returning();
    if (!foreignCategory) throw new Error("Foreign breakdown category was not created.");
    await expect(
      service.performDirect(
        "transaction_breakdown",
        {
          ...breakdown.input,
          allocations: [
            { amount: 12.34, categoryId: foreignCategory.id, rationale: "Foreign category" },
          ],
        },
        context,
      ),
    ).resolves.toMatchObject({
      status: "needs_input",
      question: { expectedAnswer: [expect.objectContaining({ name: "allocations" })] },
    });

    const transactionId = String(breakdown.input.id);
    await database.db
      .update(financeTransactions)
      .set({ pending: true })
      .where(eq(financeTransactions.id, transactionId));
    await expect(
      service.performDirect("transaction_breakdown", breakdown.input, context),
    ).resolves.toMatchObject({
      status: "needs_input",
      question: { expectedAnswer: [expect.objectContaining({ name: "id" })] },
    });
    await database.db
      .update(financeTransactions)
      .set({ pending: false })
      .where(eq(financeTransactions.id, transactionId));
    const [current] = await database.db
      .select({ updatedAt: financeTransactions.updatedAt })
      .from(financeTransactions)
      .where(eq(financeTransactions.id, transactionId));
    if (!current) throw new Error("Breakdown transaction was not found.");
    const recoveryInput = {
      ...invalidSum,
      expectedTransactionUpdatedAt: current.updatedAt.toISOString(),
    };
    const asked = await service.performDirect("transaction_breakdown", recoveryInput, context);
    if (asked.status !== "needs_input")
      throw new Error("Expected a recoverable allocation question.");
    await expect(
      service.answerQuestion(
        asked.question.id,
        JSON.stringify({ allocations: breakdown.input.allocations }),
        { principal: agent(userId), requestId: "breakdown-validation-recovery" },
      ),
    ).resolves.toMatchObject({ status: "applied" });
  });

  it("makes an evidence-backed future merchant rule independently reviewable and rejects mixed history", async () => {
    await database.db
      .insert(financeAutomationSettings)
      .values({ reviewBypassEnabled: false, userId })
      .onConflictDoUpdate({
        set: { reviewBypassEnabled: false, updatedAt: now },
        target: financeAutomationSettings.userId,
      });
    const breakdown = (
      await seedActionCases(database, userId, `Future rule ${crypto.randomUUID()}`)
    ).find((item) => item.actionKind === "transaction_breakdown");
    if (!breakdown) throw new Error("Future-rule breakdown fixture was not created.");
    const [row] = await database.db
      .select()
      .from(financeTransactions)
      .where(eq(financeTransactions.id, String(breakdown.input.id)));
    const categoryId = (breakdown.input.allocations as Array<{ categoryId: string }>)[0]
      ?.categoryId;
    const [category] = await database.db
      .select()
      .from(financeCategories)
      .where(eq(financeCategories.id, categoryId ?? ""));
    if (!row?.merchantId || !category)
      throw new Error("Future-rule evidence fixture was not created.");
    await database.db.insert(financeClassificationDecisions).values(
      [0, 1].map(() => ({
        categoryId: category.id,
        categoryName: category.name,
        confidence: 10_000,
        merchantId: row.merchantId,
        outcome: "confirmed" as const,
        source: "user" as const,
        transactionId: row.id,
        userId,
      })),
    );
    const service = createFinanceActionService({
      db: database.db,
      finances: createFinanceService({ db: database.db, now: () => now }),
      now: () => now,
    });
    const input = {
      ...breakdown.input,
      futureRule: { categoryId: category.id, rationale: "Apply this confirmed merchant pattern." },
    };
    const queued = await service.performDirect("transaction_breakdown", input, {
      principal: agent(userId),
      requestId: "future-rule-review",
    });
    if (queued.status !== "pending_review") throw new Error("Expected a future-rule review.");
    expect(queued.review.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: "finance_category_rule",
          summary: expect.stringContaining(category.name),
        }),
      ]),
    );
    expect(queued.review.sourceRefs).toContainEqual(
      expect.objectContaining({ provider: "local", remoteId: row.merchantId }),
    );
    await expect(
      service.approve(queued.review.id, {
        principal: user(userId),
        requestId: "future-rule-review-approve",
      }),
    ).resolves.toMatchObject({ status: "applied" });
    const [updatedTransaction] = await database.db
      .select({ updatedAt: financeTransactions.updatedAt })
      .from(financeTransactions)
      .where(eq(financeTransactions.id, row.id));
    if (!updatedTransaction) throw new Error("Approved future-rule transaction was not found.");
    await database.db
      .update(financeAutomationSettings)
      .set({ reviewBypassEnabled: true, updatedAt: now })
      .where(eq(financeAutomationSettings.userId, userId));
    await expect(
      service.performDirect(
        "transaction_breakdown",
        { ...input, expectedTransactionUpdatedAt: updatedTransaction.updatedAt.toISOString() },
        { principal: agent(userId), requestId: "future-rule-bypass" },
      ),
    ).resolves.toMatchObject({ status: "applied" });
    await expect(
      database.db
        .select({ category: financeCategoryRules.category })
        .from(financeCategoryRules)
        .where(eq(financeCategoryRules.userId, userId)),
    ).resolves.toEqual(expect.arrayContaining([{ category: category.name }]));
    await expect(
      database.db
        .select({ after: auditEvents.after, before: auditEvents.before })
        .from(auditEvents)
        .where(eq(auditEvents.action, "finance.transaction_breakdown_set"))
        .orderBy(auditEvents.createdAt),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          after: expect.objectContaining({
            futureRule: expect.objectContaining({ category: category.name }),
          }),
          before: expect.objectContaining({ futureRule: null }),
        }),
      ]),
    );

    const [otherCategory] = await database.db
      .insert(financeCategories)
      .values({
        group: "Future rule",
        name: `Other ${crypto.randomUUID()}`,
        slug: `other-future-rule-${crypto.randomUUID()}`,
        userId,
      })
      .returning();
    if (!otherCategory) throw new Error("Mixed future-rule category was not created.");
    const [currentTransaction] = await database.db
      .select({ updatedAt: financeTransactions.updatedAt })
      .from(financeTransactions)
      .where(eq(financeTransactions.id, row.id));
    if (!currentTransaction) throw new Error("Future-rule transaction was not found.");
    const proposedMixedRule = {
      ...input,
      allocations: [
        { amount: 6, categoryId: category.id, rationale: "Personal share" },
        { amount: 6.34, categoryId: otherCategory.id, rationale: "Reimbursable share" },
      ],
      expectedTransactionUpdatedAt: currentTransaction.updatedAt.toISOString(),
    };
    await expect(
      service.performDirect("transaction_breakdown", proposedMixedRule, {
        principal: agent(userId),
        requestId: "future-rule-proposed-mixed-bypass",
      }),
    ).resolves.toMatchObject({ status: "needs_input" });
    await database.db
      .update(financeAutomationSettings)
      .set({ reviewBypassEnabled: false, updatedAt: now })
      .where(eq(financeAutomationSettings.userId, userId));
    await expect(
      service.performDirect("transaction_breakdown", proposedMixedRule, {
        principal: agent(userId),
        requestId: "future-rule-proposed-mixed-review",
      }),
    ).resolves.toMatchObject({ status: "needs_input" });
    const pendingMixedBreakdown = await service.performDirect(
      "transaction_breakdown",
      { ...proposedMixedRule, futureRule: undefined },
      { principal: agent(userId), requestId: "mixed-breakdown-review" },
    );
    if (pendingMixedBreakdown.status !== "pending_review")
      throw new Error("Expected the one-off mixed breakdown to be reviewable.");
    await expect(
      service.approve(pendingMixedBreakdown.review.id, {
        principal: user(userId),
        requestId: "mixed-breakdown-approve",
      }),
    ).resolves.toMatchObject({ status: "applied" });
    await expect(
      database.db
        .select({ behavior: financeMerchants.behavior })
        .from(financeMerchants)
        .where(eq(financeMerchants.id, row.merchantId)),
    ).resolves.toEqual([{ behavior: "mixed" }]);
    await expect(
      database.db
        .select({ outcome: financeClassificationDecisions.outcome })
        .from(financeClassificationDecisions)
        .where(
          and(
            eq(financeClassificationDecisions.transactionId, row.id),
            eq(financeClassificationDecisions.categoryId, otherCategory.id),
          ),
        ),
    ).resolves.toEqual(expect.arrayContaining([{ outcome: "applied" }]));
    await database.db.insert(financeClassificationDecisions).values({
      categoryId: otherCategory.id,
      categoryName: otherCategory.name,
      confidence: 10_000,
      merchantId: row.merchantId,
      outcome: "confirmed",
      source: "user",
      transactionId: row.id,
      userId,
    });
    await expect(
      service.performDirect("transaction_breakdown", input, {
        principal: agent(userId),
        requestId: "future-rule-mixed",
      }),
    ).resolves.toMatchObject({ status: "needs_input" });
  });

  it("records a legacy category correction when an approved agent breakdown replaces an unbackfilled row", async () => {
    await database.db
      .insert(financeAutomationSettings)
      .values({ reviewBypassEnabled: false, userId })
      .onConflictDoUpdate({
        set: { reviewBypassEnabled: false, updatedAt: now },
        target: financeAutomationSettings.userId,
      });
    const breakdown = (
      await seedActionCases(database, userId, `Legacy agent ${crypto.randomUUID()}`)
    ).find((item) => item.actionKind === "transaction_breakdown");
    if (!breakdown) throw new Error("Legacy agent breakdown fixture was not created.");
    const oldCategoryId = (breakdown.input.allocations as Array<{ categoryId: string }>)[0]
      ?.categoryId;
    const [oldCategory] = await database.db
      .select()
      .from(financeCategories)
      .where(eq(financeCategories.id, oldCategoryId ?? ""));
    const [replacementCategory] = await database.db
      .insert(financeCategories)
      .values({
        group: "Test",
        name: `Legacy replacement ${crypto.randomUUID()}`,
        slug: `legacy-replacement-${crypto.randomUUID()}`,
        userId,
      })
      .returning();
    if (!oldCategory || !replacementCategory)
      throw new Error("Legacy agent categories were not created.");
    const transactionId = String(breakdown.input.id);
    await database.db
      .update(financeTransactions)
      .set({ category: oldCategory.name, categoryId: oldCategory.id })
      .where(eq(financeTransactions.id, transactionId));
    const [legacyTransaction] = await database.db
      .select({ updatedAt: financeTransactions.updatedAt })
      .from(financeTransactions)
      .where(eq(financeTransactions.id, transactionId));
    if (!legacyTransaction) throw new Error("Legacy agent transaction was not found.");
    const service = createFinanceActionService({
      db: database.db,
      finances: createFinanceService({ db: database.db, now: () => now }),
      now: () => now,
    });
    const queued = await service.performDirect(
      "transaction_breakdown",
      {
        ...breakdown.input,
        allocations: [
          { amount: 12.34, categoryId: replacementCategory.id, rationale: "Approved replacement" },
        ],
        expectedTransactionUpdatedAt: legacyTransaction.updatedAt.toISOString(),
      },
      { principal: agent(userId), requestId: "legacy-agent-breakdown" },
    );
    if (queued.status !== "pending_review")
      throw new Error("Expected the legacy agent breakdown to await approval.");
    await expect(
      service.approve(queued.review.id, {
        principal: user(userId),
        requestId: "legacy-agent-breakdown-approve",
      }),
    ).resolves.toMatchObject({ status: "applied" });
    await expect(
      database.db
        .select({
          categoryId: financeClassificationDecisions.categoryId,
          outcome: financeClassificationDecisions.outcome,
        })
        .from(financeClassificationDecisions)
        .where(eq(financeClassificationDecisions.transactionId, transactionId)),
    ).resolves.toEqual(
      expect.arrayContaining([
        { categoryId: oldCategory.id, outcome: "corrected" },
        { categoryId: replacementCategory.id, outcome: "applied" },
      ]),
    );
  });

  it("keeps bypass out of categorization evidence while allowing prepared permanent rules", async () => {
    await database.db
      .update(financeAutomationSettings)
      .set({ reviewBypassEnabled: true, updatedAt: now })
      .where(eq(financeAutomationSettings.userId, userId));
    const [account] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "Evidence",
        name: "Evidence",
        provider: "manual",
        status: "manual",
        userId,
      })
      .returning();
    const [category] = await database.db
      .insert(financeCategories)
      .values({
        group: "Test",
        name: "Evidence category",
        slug: `evidence-${crypto.randomUUID()}`,
        userId,
      })
      .returning();
    const [merchant] = await database.db
      .insert(financeMerchants)
      .values({
        displayName: "Evidence merchant",
        normalizedName: `evidence-${crypto.randomUUID()}`,
        userId,
      })
      .returning();
    if (!account || !category || !merchant) throw new Error("Evidence targets were not created.");
    const [transaction] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: account.id,
        amount: 100,
        direction: "expense",
        merchant: merchant.displayName,
        merchantId: merchant.id,
        transactionDate: "2026-08-17",
        userId,
      })
      .returning();
    if (!transaction) throw new Error("Evidence transaction was not created.");
    const decision = (confidence: number, learnMerchant: "always" | "suggest" = "suggest") => ({
      decisions: [
        {
          categoryId: category.id,
          confidence,
          expectedTransactionUpdatedAt: transaction.updatedAt.toISOString(),
          learnMerchant,
          rationale: "Two confirmed merchant observations.",
          transactionId: transaction.id,
        },
      ],
    });
    const service = createFinanceActionService({
      db: database.db,
      finances: createFinanceService({ db: database.db, now: () => now }),
      now: () => now,
    });
    const context = { principal: agent(userId), requestId: "evidence-bypass" };

    const lowConfidence = await service.performDirect("categorization", decision(0.5), context);
    if (lowConfidence.status !== "needs_input") throw new Error("Expected an evidence question.");
    expect(lowConfidence.question.expectedAnswer.map((field) => field.name)).toEqual(["decisions"]);
    await expect(
      database.db
        .select({ categoryId: financeTransactions.categoryId })
        .from(financeTransactions)
        .where(eq(financeTransactions.id, transaction.id)),
    ).resolves.toEqual([{ categoryId: null }]);
    await database.db
      .update(financeTransactions)
      .set({ reconciliationStatus: "candidate" })
      .where(eq(financeTransactions.id, transaction.id));
    const ambiguousTransfer = await service.performDirect("categorization", decision(0.5), context);
    if (ambiguousTransfer.status !== "needs_input")
      throw new Error("Expected an evidence question.");
    expect(ambiguousTransfer.question.expectedAnswer.map((field) => field.name)).toEqual([
      "decisions",
    ]);
    await database.db
      .update(financeTransactions)
      .set({ reconciliationStatus: "not_applicable", updatedAt: transaction.updatedAt })
      .where(eq(financeTransactions.id, transaction.id));
    await database.db.insert(financeClassificationDecisions).values([
      {
        categoryId: category.id,
        categoryName: category.name,
        confidence: 10_000,
        merchantId: merchant.id,
        outcome: "confirmed",
        source: "user",
        transactionId: transaction.id,
        userId,
      },
      {
        categoryId: category.id,
        categoryName: category.name,
        confidence: 10_000,
        merchantId: merchant.id,
        outcome: "confirmed",
        source: "user",
        transactionId: transaction.id,
        userId,
      },
    ]);
    await expect(
      service.performDirect("categorization", decision(0.965, "always"), context),
    ).resolves.toMatchObject({ status: "applied" });
    await database.db
      .update(financeAutomationSettings)
      .set({ reviewBypassEnabled: false, updatedAt: now })
      .where(eq(financeAutomationSettings.userId, userId));
    const [nextTransaction] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: account.id,
        amount: 101,
        direction: "expense",
        merchant: merchant.displayName,
        merchantId: merchant.id,
        transactionDate: "2026-08-18",
        userId,
      })
      .returning();
    if (!nextTransaction) throw new Error("Queued evidence transaction was not created.");
    await expect(
      service.performDirect(
        "categorization",
        {
          decisions: [
            {
              categoryId: category.id,
              confidence: 1,
              expectedTransactionUpdatedAt: nextTransaction.updatedAt.toISOString(),
              learnMerchant: "always",
              rationale: "Two confirmed merchant observations.",
              transactionId: nextTransaction.id,
            },
          ],
        },
        context,
      ),
    ).resolves.toMatchObject({ status: "pending_review" });
  });

  it("excludes question rows from approvals and terminalizes a valid answer", async () => {
    await database.db
      .update(financeAutomationSettings)
      .set({ reviewBypassEnabled: true, updatedAt: now })
      .where(eq(financeAutomationSettings.userId, userId));
    const [account] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "Question bank",
        name: "Question checking",
        provider: "manual",
        status: "manual",
        userId,
      })
      .returning();
    if (!account) throw new Error("Question account was not created.");
    const [stored] = await database.db
      .insert(financeAgentActionReviews)
      .values({
        actionKind: "question",
        fingerprint: "question-list-and-answer",
        privatePayload: {
          original: {
            actionKind: "profile",
            input: { payAccountId: "00000000-0000-4000-8000-000000000000" },
          },
          question: {
            actionKind: "profile",
            choices: [],
            expectedAnswer: [
              {
                example: "00000000-0000-4000-8000-000000000000",
                name: "payAccountId",
                required: true,
                type: "string",
              },
              {
                choices: ["full_time"],
                name: "employmentType",
                required: true,
                type: "string",
              },
            ],
            id: "00000000-0000-4000-8000-000000000001",
            prompt: "Choose a pay account.",
            sourceRefs: [],
            why: "The supplied account is not owned.",
          },
        },
        requestingAgentId: "finance-agent",
        safeChanges: [
          { entityId: null, entityType: "finance_profile", summary: "Supply account." },
        ],
        sourceRefs: [],
        userId,
      })
      .returning();
    if (!stored) throw new Error("Question row was not created.");
    const updateProfile = vi.fn(async () => ({ id: "answered-profile" }));
    const service = createFinanceActionService({
      db: database.db,
      finances: { updateProfile } as never,
      now: () => now,
    });

    await expect(service.listReviews(userId)).resolves.not.toContainEqual(
      expect.objectContaining({ id: stored.id }),
    );
    await expect(service.listQuestions(userId)).resolves.toContainEqual(
      expect.objectContaining({
        expectedAnswer: expect.arrayContaining([
          expect.objectContaining({ name: "payAccountId", type: "string" }),
        ]),
        id: stored.id,
      }),
    );
    const publicQuestion = (await service.listQuestions(userId)).find(
      (question) => question.id === stored.id,
    );
    if (!publicQuestion) throw new Error("Question was not listed.");
    expect(publicQuestion).not.toHaveProperty("privatePayload");
    expect(publicQuestion).not.toHaveProperty("answer");
    await expect(
      service.answerQuestion(stored.id, "not JSON", {
        principal: agent(userId),
        requestId: "answer-question-malformed",
      }),
    ).resolves.toMatchObject({
      question: { id: stored.id },
      status: "needs_input",
    });
    await expect(
      service.answerQuestion(stored.id, JSON.stringify({ unrelated: account.id }), {
        principal: agent(userId),
        requestId: "answer-question-unexpected-key",
      }),
    ).resolves.toMatchObject({ status: "needs_input" });
    await expect(
      service.answerQuestion(stored.id, JSON.stringify({ payAccountId: 42 }), {
        principal: agent(userId),
        requestId: "answer-question-invalid-type",
      }),
    ).resolves.toMatchObject({ status: "needs_input" });
    await expect(
      database.db
        .select({ status: financeAgentActionReviews.status })
        .from(financeAgentActionReviews)
        .where(eq(financeAgentActionReviews.id, stored.id)),
    ).resolves.toEqual([{ status: "pending" }]);
    await expect(
      service.answerQuestion(
        stored.id,
        JSON.stringify({ payAccountId: account.id, employmentType: "full_time" }),
        {
          principal: agent(userId),
          requestId: "answer-question",
        },
      ),
    ).resolves.toMatchObject({ result: { id: "answered-profile" }, status: "applied" });
    await expect(
      service.answerQuestion(
        stored.id,
        JSON.stringify({ employmentType: "full_time", payAccountId: account.id }),
        { principal: agent(userId), requestId: "answer-question-reordered" },
      ),
    ).resolves.toMatchObject({ result: { id: "answered-profile" }, status: "applied" });
    await expect(
      database.db
        .select({ status: financeAgentActionReviews.status })
        .from(financeAgentActionReviews)
        .where(eq(financeAgentActionReviews.id, stored.id)),
    ).resolves.toEqual([{ status: "superseded" }]);
    expect(updateProfile).toHaveBeenCalledOnce();
  });

  it("asks for a replacement pay account and resumes the original profile action", async () => {
    await database.db
      .insert(financeAutomationSettings)
      .values({ reviewBypassEnabled: true, userId })
      .onConflictDoUpdate({
        set: { reviewBypassEnabled: true, updatedAt: now },
        target: financeAutomationSettings.userId,
      });
    const [ownedAccount] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "Owned question bank",
        name: "Owned question account",
        provider: "manual",
        status: "manual",
        userId,
      })
      .returning();
    const [otherUser] = await database.db
      .insert(users)
      .values({
        displayName: "Other Finance owner",
        email: `other-question-${crypto.randomUUID()}@example.com`,
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!otherUser) throw new Error("Other Finance owner was not created.");
    const [foreignAccount] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "Foreign question bank",
        name: "Foreign question account",
        provider: "manual",
        status: "manual",
        userId: otherUser.id,
      })
      .returning();
    if (!ownedAccount || !foreignAccount)
      throw new Error("Question account fixtures were not created.");
    const updateProfile = vi.fn(async () => ({ id: "resumed-profile" }));
    const service = createFinanceActionService({
      db: database.db,
      finances: { updateProfile } as never,
      now: () => now,
    });
    const asked = await service.performDirect(
      "profile",
      {
        effectiveDate: "2026-09-01",
        employer: "Ilo",
        payAccountId: foreignAccount.id,
        payFrequency: "monthly",
      },
      { principal: agent(userId), requestId: "foreign-pay-account" },
    );
    if (asked.status !== "needs_input") throw new Error("Expected a Finance question.");
    expect(asked.question.expectedAnswer).toEqual([
      expect.objectContaining({ name: "payAccountId", required: true, type: "string" }),
    ]);

    await expect(
      service.answerQuestion(asked.question.id, JSON.stringify({ payAccountId: ownedAccount.id }), {
        principal: agent(userId),
        requestId: "replace-pay-account",
      }),
    ).resolves.toMatchObject({ result: { id: "resumed-profile" }, status: "applied" });
    expect(updateProfile).toHaveBeenCalledWith(
      expect.objectContaining({ effectiveDate: "2026-09-01", payAccountId: ownedAccount.id }),
      expect.anything(),
      expect.anything(),
    );
  });

  it("projects only bounded material profile changes into a pending review", async () => {
    await database.db
      .insert(financeAutomationSettings)
      .values({ reviewBypassEnabled: false, userId })
      .onConflictDoUpdate({
        set: { reviewBypassEnabled: false, updatedAt: now },
        target: financeAutomationSettings.userId,
      });
    const service = createFinanceActionService({
      db: database.db,
      finances: { updateProfile: vi.fn() } as never,
      now: () => now,
    });
    const outcome = await service.performDirect(
      "profile",
      {
        effectiveDate: "2026-12-01",
        employer: "Private employer text must not be projected",
        expectedNetPay: 1234.56,
        payFrequency: "monthly",
      },
      { principal: agent(userId), requestId: "profile-projection" },
    );
    if (outcome.status !== "pending_review") throw new Error("Expected a pending review.");
    expect(outcome.review.changes[0]?.summary).toContain("net pay unset → $1234.56");
    expect(outcome.review.changes[0]?.summary).toContain("pay frequency unset → monthly");
    expect(outcome.review.changes[0]?.summary).not.toContain("Private employer text");
  });

  it("summarizes every material profile field while redacting private employer and role values", async () => {
    await database.db
      .update(financeAutomationSettings)
      .set({ reviewBypassEnabled: false, updatedAt: now })
      .where(eq(financeAutomationSettings.userId, userId));
    const [account] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "Profile summary bank",
        name: "Profile summary checking",
        provider: "manual",
        status: "manual",
        userId,
      })
      .returning();
    if (!account) throw new Error("Profile summary account was not created.");
    const outcome = await createFinanceActionService({
      db: database.db,
      finances: { updateProfile: vi.fn() } as never,
      now: () => now,
    }).performDirect(
      "profile",
      {
        dependents: 2,
        effectiveDate: "2026-12-02",
        employer: "Private employer canary",
        employmentType: "full_time",
        expectedNetPay: 1234.56,
        grossAnnualIncome: 98765.43,
        householdSize: 4,
        housingStatus: "renting",
        investmentRiskCapacity: "moderate",
        investmentRiskWillingness: "growth",
        monthlyHousingCost: 2100,
        nextPayday: "2026-12-06",
        payAccountId: account.id,
        payFrequency: "biweekly",
        reserveTargetMonths: 6,
        role: "Private role canary",
      },
      { principal: agent(userId), requestId: "profile-all-material-fields" },
    );
    if (outcome.status !== "pending_review") throw new Error("Expected a pending review.");
    const summary = outcome.review.changes[0]?.summary ?? "";
    expect(summary).toContain("employer updated.");
    expect(summary).toContain("role updated.");
    expect(summary).toContain("employment unset → full time");
    expect(summary).toContain("net pay unset → $1234.56");
    expect(summary).toContain("annual income unset → $98765.43");
    expect(summary).toContain("next payday unset → 2026-12-06");
    expect(summary).toContain("pay account unset → selected account");
    expect(summary).toContain("housing status unset → renting");
    expect(summary).toContain("housing cost unset → $2100.00");
    expect(summary).toContain("risk capacity unset → moderate");
    expect(summary).toContain("risk willingness unset → growth");
    expect(summary).toContain("reserve target unset → 6 months");
    expect(summary).toContain("household size unset → 4");
    expect(summary).toContain("dependents unset → 2");
    expect(summary).not.toContain("Private employer canary");
    expect(summary).not.toContain("Private role canary");
    expect(summary.length).toBeLessThanOrEqual(500);
  });

  it("renders nullable profile clears as unset without converting them to zero", async () => {
    const [existing] = await database.db
      .insert(financeProfiles)
      .values({
        effectiveDate: "2026-12-05",
        expectedNetPay: 123_456,
        grossAnnualIncome: 9_876_543,
        monthlyHousingCost: 2_100_00,
        payFrequency: "monthly",
        reserveTargetMonths: 6,
        userId,
      })
      .returning();
    if (!existing) throw new Error("Clearable Finance profile was not created.");
    const outcome = await createFinanceActionService({
      db: database.db,
      finances: { updateProfile: vi.fn() } as never,
      now: () => now,
    }).performDirect(
      "profile",
      {
        effectiveDate: existing.effectiveDate,
        expectedNetPay: null,
        grossAnnualIncome: null,
        monthlyHousingCost: null,
        payFrequency: null,
        reserveTargetMonths: null,
      },
      { principal: agent(userId), requestId: "profile-clear-projection" },
    );
    if (outcome.status !== "pending_review") throw new Error("Expected a pending review.");
    const summary = outcome.review.changes[0]?.summary ?? "";
    expect(summary).toContain("net pay $1234.56 → unset");
    expect(summary).toContain("annual income $98765.43 → unset");
    expect(summary).toContain("housing cost $2100.00 → unset");
    expect(summary).toContain("pay frequency monthly → unset");
    expect(summary).toContain("reserve target 6 months → unset");
    expect(summary).not.toContain("$0.00");
  });

  it("describes and recovers each representative invalid profile field", async () => {
    await database.db
      .update(financeAutomationSettings)
      .set({ reviewBypassEnabled: true, updatedAt: now })
      .where(eq(financeAutomationSettings.userId, userId));
    const updateProfile = vi.fn(async () => ({ id: "recovered-profile" }));
    const service = createFinanceActionService({
      db: database.db,
      finances: { updateProfile } as never,
      now: () => now,
    });
    const cases = [
      {
        expected: {
          choices: ["contract", "full_time", "part_time", "self_employed", "unemployed"],
          name: "employmentType",
          nullable: true,
          type: "string",
        },
        input: {
          effectiveDate: "2026-12-06",
          employmentType: "sometimes",
          monthlyHousingCost: null,
        },
        patch: { employmentType: null },
      },
      {
        expected: { example: "0 to 20", name: "dependents", nullable: true, type: "number" },
        input: { dependents: 21, effectiveDate: "2026-12-07" },
        patch: { dependents: 1 },
      },
      {
        expected: { example: "YYYY-MM-DD", name: "nextPayday", nullable: true, type: "string" },
        input: { effectiveDate: "2026-12-08", nextPayday: "tomorrow" },
        patch: { nextPayday: null },
      },
      {
        expected: {
          example: "0 to 100000000",
          name: "monthlyHousingCost",
          nullable: true,
          type: "number",
        },
        input: { effectiveDate: "2026-12-09", monthlyHousingCost: -1 },
        patch: { monthlyHousingCost: null },
      },
    ];
    for (const item of cases) {
      const asked = await service.performDirect("profile", item.input, {
        principal: agent(userId),
        requestId: `profile-invalid-${item.expected.name}`,
      });
      if (asked.status !== "needs_input")
        throw new Error("Expected a recoverable Finance question.");
      expect(asked.question.expectedAnswer).toEqual([
        expect.objectContaining({ ...item.expected, required: true }),
      ]);
      await expect(
        service.answerQuestion(asked.question.id, JSON.stringify(item.patch), {
          principal: agent(userId),
          requestId: `profile-recover-${item.expected.name}`,
        }),
      ).resolves.toMatchObject({ status: "applied" });
    }
    expect(updateProfile).toHaveBeenCalledWith(
      expect.objectContaining({ monthlyHousingCost: null }),
      expect.anything(),
      expect.anything(),
    );
    await database.db
      .update(financeAutomationSettings)
      .set({ reviewBypassEnabled: false, updatedAt: now })
      .where(eq(financeAutomationSettings.userId, userId));
  });

  it("marks every nullable profile correction and rejects null for effective date", async () => {
    const service = createFinanceActionService({
      db: database.db,
      finances: { updateProfile: vi.fn(async () => ({ id: "nullable-profile" })) } as never,
      now: () => now,
    });
    const nullableCases: Array<[string, Record<string, unknown>]> = [
      ["dependents", { dependents: 21 }],
      ["employer", { employer: "x".repeat(161) }],
      ["employmentType", { employmentType: "invalid" }],
      ["expectedNetPay", { expectedNetPay: -1 }],
      ["grossAnnualIncome", { grossAnnualIncome: "invalid" }],
      ["householdSize", { householdSize: 0 }],
      ["housingStatus", { housingStatus: "invalid" }],
      ["investmentRiskCapacity", { investmentRiskCapacity: "invalid" }],
      ["investmentRiskWillingness", { investmentRiskWillingness: "invalid" }],
      ["monthlyHousingCost", { monthlyHousingCost: -1 }],
      ["nextPayday", { nextPayday: "tomorrow" }],
      ["payAccountId", { payAccountId: "not-an-id" }],
      ["payFrequency", { payFrequency: "sometimes" }],
      ["reserveTargetMonths", { reserveTargetMonths: 0 }],
      ["role", { role: "x".repeat(161) }],
    ];

    for (const [index, [field, invalid]] of nullableCases.entries()) {
      const asked = await service.performDirect(
        "profile",
        { effectiveDate: `2026-11-${String(index + 1).padStart(2, "0")}`, ...invalid },
        { principal: agent(userId), requestId: `profile-nullable-descriptor-${field}` },
      );
      if (asked.status !== "needs_input")
        throw new Error("Expected a profile correction question.");
      expect(asked.question.expectedAnswer).toEqual([
        expect.objectContaining({ name: field, nullable: true, required: true }),
      ]);
    }

    const nonNullable = await service.performDirect(
      "profile",
      { effectiveDate: null },
      { principal: agent(userId), requestId: "profile-non-nullable-effective-date" },
    );
    if (nonNullable.status !== "needs_input")
      throw new Error("Expected an effective date question.");
    expect(nonNullable.question.expectedAnswer).toEqual([
      expect.objectContaining({ name: "effectiveDate", nullable: false, required: true }),
    ]);
    await expect(
      service.answerQuestion(nonNullable.question.id, JSON.stringify({ effectiveDate: null }), {
        principal: agent(userId),
        requestId: "profile-non-nullable-effective-date-answer",
      }),
    ).resolves.toMatchObject({ status: "needs_input" });
  });

  it("labels merchant merge source and target by their requested IDs", async () => {
    const [source] = await database.db
      .insert(financeMerchants)
      .values({
        displayName: "Source merchant",
        normalizedName: `source-${crypto.randomUUID()}`,
        userId,
      })
      .returning();
    const [target] = await database.db
      .insert(financeMerchants)
      .values({
        displayName: "Target merchant",
        normalizedName: `target-${crypto.randomUUID()}`,
        userId,
      })
      .returning();
    if (!source || !target) throw new Error("Merchant merge fixtures were not created.");
    const service = createFinanceActionService({
      db: database.db,
      finances: { mergeMerchants: vi.fn() } as never,
      now: () => now,
    });
    const outcome = await service.performDirect(
      "merchant",
      {
        rationale: "Consolidate aliases.",
        sourceMerchantId: source.id,
        targetMerchantId: target.id,
      },
      { principal: agent(userId), requestId: "merchant-projection" },
    );
    if (outcome.status !== "pending_review") throw new Error("Expected a pending review.");
    expect(outcome.review.changes[0]?.summary).toBe("Merge Source merchant into Target merchant.");
  });

  it("names the existing and replacement merchant in a rename review", async () => {
    const [merchant] = await database.db
      .insert(financeMerchants)
      .values({
        displayName: "Merchant before rename",
        normalizedName: `merchant-before-${crypto.randomUUID()}`,
        userId,
      })
      .returning();
    if (!merchant) throw new Error("Merchant rename fixture was not created.");
    const outcome = await createFinanceActionService({
      db: database.db,
      finances: { updateMerchant: vi.fn() } as never,
      now: () => now,
    }).performDirect(
      "merchant",
      { displayName: "Merchant after rename", id: merchant.id },
      { principal: agent(userId), requestId: "merchant-rename-projection" },
    );
    if (outcome.status !== "pending_review") throw new Error("Expected a pending review.");
    expect(outcome.review.changes[0]?.summary).toBe(
      "Rename Merchant before rename to Merchant after rename.",
    );
  });

  it("serializes concurrent changed profile proposals on their semantic target", async () => {
    await database.db
      .update(financeAutomationSettings)
      .set({ reviewBypassEnabled: false, updatedAt: now })
      .where(eq(financeAutomationSettings.userId, userId));
    const service = createFinanceActionService({
      db: database.db,
      finances: { updateProfile: vi.fn() } as never,
      now: () => now,
    });
    const context = { principal: agent(userId), requestId: "concurrent-profile" };
    const [left, right] = await Promise.all([
      service.performDirect("profile", { effectiveDate: "2026-09-01", employer: "Left" }, context),
      service.performDirect("profile", { effectiveDate: "2026-09-01", employer: "Right" }, context),
    ]);
    expect([left.status, right.status]).toEqual(["pending_review", "pending_review"]);
    await expect(
      database.db
        .select({ status: financeAgentActionReviews.status })
        .from(financeAgentActionReviews)
        .where(eq(financeAgentActionReviews.userId, userId)),
    ).resolves.toEqual(expect.arrayContaining([{ status: "superseded" }, { status: "pending" }]));
  });

  it("reuses one pending review for concurrent exact profile proposals", async () => {
    await database.db
      .update(financeAutomationSettings)
      .set({ reviewBypassEnabled: false })
      .where(eq(financeAutomationSettings.userId, userId));
    const service = createFinanceActionService({
      db: database.db,
      finances: { updateProfile: vi.fn() } as never,
      now: () => now,
    });
    const input = { effectiveDate: "2026-09-02", employer: "Exact" };
    const context = { principal: agent(userId), requestId: "concurrent-exact" };
    const [left, right] = await Promise.all([
      service.performDirect("profile", input, context),
      service.performDirect("profile", input, context),
    ]);
    if (left.status !== "pending_review" || right.status !== "pending_review")
      throw new Error("Expected pending reviews.");
    expect(left.review.id).toBe(right.review.id);
  });

  it("keeps concurrent disjoint profile targets pending independently", async () => {
    const service = createFinanceActionService({
      db: database.db,
      finances: { updateProfile: vi.fn() } as never,
      now: () => now,
    });
    const context = { principal: agent(userId), requestId: "concurrent-disjoint" };
    const [left, right] = await Promise.all([
      service.performDirect("profile", { effectiveDate: "2026-09-03", employer: "A" }, context),
      service.performDirect("profile", { effectiveDate: "2026-09-04", employer: "B" }, context),
    ]);
    if (left.status !== "pending_review" || right.status !== "pending_review")
      throw new Error("Expected pending reviews.");
    expect(left.review.id).not.toBe(right.review.id);
  });

  it("supersedes concurrent overlapping categorization proposals", async () => {
    const [account] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "Overlap",
        name: "Overlap",
        provider: "manual",
        status: "manual",
        userId,
      })
      .returning();
    const [category] = await database.db
      .insert(financeCategories)
      .values({ group: "Custom", name: "Overlap", slug: `overlap-${crypto.randomUUID()}`, userId })
      .returning();
    if (!account || !category) throw new Error("Overlap categorization fixtures were not created.");
    const [transaction] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: account.id,
        amount: 100,
        direction: "expense",
        merchant: "Overlap",
        transactionDate: "2026-09-05",
        userId,
      })
      .returning();
    if (!transaction) throw new Error("Overlap categorization transaction was not created.");
    const service = createFinanceActionService({
      db: database.db,
      finances: {
        applyCategorizations: vi.fn(),
        validatePreparedCategorizations: vi.fn(async () => true),
      } as never,
      now: () => now,
    });
    const decision = (rationale: string) => ({
      decisions: [
        {
          categoryId: category.id,
          confidence: 1,
          expectedTransactionUpdatedAt: transaction.updatedAt.toISOString(),
          learnMerchant: "suggest",
          rationale,
          transactionId: transaction.id,
        },
      ],
    });
    const context = { principal: agent(userId), requestId: "categorization-overlap" };
    await Promise.all([
      service.performDirect("categorization", decision("first"), context),
      service.performDirect("categorization", decision("second"), context),
    ]);
    const rows = await database.db
      .select({ status: financeAgentActionReviews.status })
      .from(financeAgentActionReviews)
      .where(eq(financeAgentActionReviews.userId, userId));
    expect(rows.filter((row) => row.status === "pending").length).toBeGreaterThan(0);
    expect(rows.some((row) => row.status === "superseded")).toBe(true);
  });

  it("supersedes concurrent changed budget plans for the same month", async () => {
    const [category] = await database.db
      .insert(financeCategories)
      .values({
        group: "Custom",
        name: "Budget overlap",
        slug: `budget-${crypto.randomUUID()}`,
        userId,
      })
      .returning();
    if (!category) throw new Error("Budget category was not created.");
    const service = createFinanceActionService({
      db: database.db,
      finances: { setBudgetPlan: vi.fn() } as never,
      now: () => now,
    });
    const context = { principal: agent(userId), requestId: "budget-overlap" };
    const plan = (limit: number) => ({
      allocations: [{ categoryId: category.id, limit }],
      assumptions: [],
      goalIds: [],
      month: "2026-09",
      rationale: `Plan ${limit}`,
      replace: true,
      scenarioFingerprint: null,
    });
    await Promise.all([
      service.performDirect("budget_plan", plan(100), context),
      service.performDirect("budget_plan", plan(200), context),
    ]);
    const rows = await database.db
      .select({ status: financeAgentActionReviews.status })
      .from(financeAgentActionReviews)
      .where(eq(financeAgentActionReviews.userId, userId));
    expect(rows.some((row) => row.status === "pending")).toBe(true);
    expect(rows.some((row) => row.status === "superseded")).toBe(true);
  });

  it("supersedes a single-category budget review with a complete plan for the same month", async () => {
    const [category] = await database.db
      .insert(financeCategories)
      .values({
        group: "Custom",
        name: "Cross variant budget",
        slug: `cross-budget-${crypto.randomUUID()}`,
        userId,
      })
      .returning();
    if (!category) throw new Error("Budget category was not created.");
    const service = createFinanceActionService({
      db: database.db,
      finances: { createBudget: vi.fn(), setBudgetPlan: vi.fn() } as never,
      now: () => now,
    });
    const context = { principal: agent(userId), requestId: "budget-cross-variant" };
    const month = "2026-10";

    await service.performDirect(
      "budget_plan",
      { category: category.name, limit: 100, month },
      context,
    );
    await service.performDirect(
      "budget_plan",
      {
        allocations: [{ categoryId: category.id, limit: 200 }],
        assumptions: [],
        goalIds: [],
        month,
        rationale: "Replace the single allocation.",
        replace: true,
        scenarioFingerprint: null,
      },
      context,
    );

    const rows = await database.db
      .select({
        semanticTargetKeys: financeAgentActionReviews.semanticTargetKeys,
        status: financeAgentActionReviews.status,
      })
      .from(financeAgentActionReviews)
      .where(eq(financeAgentActionReviews.userId, userId));
    const monthRows = rows.filter((row) =>
      (row.semanticTargetKeys as string[]).some((key) => key.includes(month)),
    );
    expect(monthRows.filter((row) => row.status === "pending").length).toBe(1);
    expect(monthRows.some((row) => row.status === "superseded")).toBe(true);
  });

  it("supersedes a complete budget plan when a capacity input changes before approval", async () => {
    await database.db
      .insert(financeAutomationSettings)
      .values({ reviewBypassEnabled: false, userId })
      .onConflictDoUpdate({
        set: { reviewBypassEnabled: false, updatedAt: now },
        target: financeAutomationSettings.userId,
      });
    const [category] = await database.db
      .insert(financeCategories)
      .values({
        group: "Custom",
        name: "Capacity budget",
        slug: `capacity-budget-${crypto.randomUUID()}`,
        userId,
      })
      .returning();
    const [obligation] = await database.db
      .insert(financeRecurringObligations)
      .values({
        cadence: "monthly",
        confidence: 10_000,
        displayName: "Capacity obligation",
        expectedAmount: 10_000,
        amountTolerance: 0,
        kind: "bill",
        merchant: `capacity-${crypto.randomUUID()}`,
        source: "user",
        status: "active",
        userId,
      })
      .returning();
    if (!category || !obligation) throw new Error("Budget capacity fixtures were not created.");
    const setBudgetPlan = vi.fn(async () => ({ id: "capacity-plan" }));
    const service = createFinanceActionService({
      db: database.db,
      finances: { setBudgetPlan } as never,
      now: () => now,
    });
    const queued = await service.performDirect(
      "budget_plan",
      {
        allocations: [{ categoryId: category.id, limit: 100 }],
        assumptions: [],
        goalIds: [],
        month: "2026-11",
        rationale: "Use the current capacity evidence.",
        replace: true,
        scenarioFingerprint: null,
      },
      { principal: agent(userId), requestId: "capacity-budget-queue" },
    );
    if (queued.status !== "pending_review") throw new Error("Expected a pending Finance review.");
    await database.db
      .update(financeRecurringObligations)
      .set({ status: "paused", updatedAt: new Date("2026-08-17T12:02:00.000Z") })
      .where(eq(financeRecurringObligations.id, obligation.id));

    await expect(
      service.approve(queued.review.id, {
        principal: user(userId),
        requestId: "capacity-budget-approve",
      }),
    ).resolves.toMatchObject({ status: "needs_input" });
    expect(setBudgetPlan).not.toHaveBeenCalled();
  });

  it("makes each budget-plan allocation independently reviewable by category, amount, and plan count", async () => {
    const categories = await database.db
      .insert(financeCategories)
      .values([
        {
          group: "Budget review",
          name: "Budget review groceries",
          slug: `budget-review-groceries-${crypto.randomUUID()}`,
          userId,
        },
        {
          group: "Budget review",
          name: "Budget review utilities",
          slug: `budget-review-utilities-${crypto.randomUUID()}`,
          userId,
        },
      ])
      .returning();
    if (categories.length !== 2) throw new Error("Budget review categories were not created.");
    const outcome = await createFinanceActionService({
      db: database.db,
      finances: { setBudgetPlan: vi.fn() } as never,
      now: () => now,
    }).performDirect(
      "budget_plan",
      {
        allocations: [
          { categoryId: categories[0]?.id, limit: 123.45 },
          { categoryId: categories[1]?.id, limit: 67.89 },
        ],
        assumptions: [],
        goalIds: [],
        month: "2026-12",
        rationale: "Make the plan review actionable.",
        replace: true,
        scenarioFingerprint: null,
      },
      { principal: agent(userId), requestId: "budget-plan-actionable-summary" },
    );
    if (outcome.status !== "pending_review") throw new Error("Expected a pending review.");
    expect(outcome.review.changes).toHaveLength(2);
    expect(outcome.review.changes.map((change) => change.summary)).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "Set 2026-12 Budget review groceries allocation to $123.45 (2 allocations).",
        ),
        "Set 2026-12 Budget review utilities allocation to $67.89 (2 allocations).",
      ]),
    );
  });

  it("discloses plan replacement mode and bounded existing allocation effects", async () => {
    const categories = await database.db
      .insert(financeCategories)
      .values([
        {
          group: "Replacement review",
          name: "Replacement groceries",
          slug: `replacement-groceries-${crypto.randomUUID()}`,
          userId,
        },
        {
          group: "Replacement review",
          name: "Replacement transit",
          slug: `replacement-transit-${crypto.randomUUID()}`,
          userId,
        },
      ])
      .returning();
    if (categories.length !== 2) throw new Error("Replacement review categories were not created.");
    await database.db.insert(financeBudgets).values([
      { category: "Replacement groceries", limit: 4_000, month: "2026-11", userId },
      { category: "Legacy removed category", limit: 2_500, month: "2026-11", userId },
    ]);
    const outcome = await createFinanceActionService({
      db: database.db,
      finances: { setBudgetPlan: vi.fn() } as never,
      now: () => now,
    }).performDirect(
      "budget_plan",
      {
        allocations: [
          { categoryId: categories[0]?.id, limit: 123.45 },
          { categoryId: categories[1]?.id, limit: 67.89 },
        ],
        assumptions: [],
        goalIds: [],
        month: "2026-11",
        rationale: "Review replacement effects.",
        replace: true,
        scenarioFingerprint: null,
      },
      { principal: agent(userId), requestId: "budget-plan-replacement-summary" },
    );
    if (outcome.status !== "pending_review") throw new Error("Expected a pending review.");
    const summary = outcome.review.changes[0]?.summary ?? "";
    expect(summary).toContain("Replace true");
    expect(summary).toContain("Replacement groceries $40.00 → replaced");
    expect(summary).toContain("Legacy removed category $25.00 → removed");
    expect(summary).toContain("Set 2026-11 Replacement groceries allocation to $123.45");
    expect(summary.length).toBeLessThanOrEqual(500);

    const retained = await createFinanceActionService({
      db: database.db,
      finances: { setBudgetPlan: vi.fn() } as never,
      now: () => now,
    }).performDirect(
      "budget_plan",
      {
        allocations: [{ categoryId: categories[0]?.id, limit: 123.45 }],
        assumptions: [],
        goalIds: [],
        month: "2026-11",
        rationale: "Review retained allocations.",
        replace: false,
        scenarioFingerprint: null,
      },
      { principal: agent(userId), requestId: "budget-plan-retained-summary" },
    );
    if (retained.status !== "pending_review") throw new Error("Expected a pending review.");
    expect(retained.review.changes[0]?.summary).toContain("Replace false");
    expect(retained.review.changes[0]?.summary).toContain(
      "Legacy removed category $25.00 → retained",
    );
  });

  it("queues and revalidates a maximum-size budget plan with a bounded public revision", async () => {
    await database.db
      .insert(financeAutomationSettings)
      .values({ reviewBypassEnabled: false, userId })
      .onConflictDoUpdate({
        set: { reviewBypassEnabled: false, updatedAt: now },
        target: financeAutomationSettings.userId,
      });
    const categories = await database.db
      .insert(financeCategories)
      .values(
        Array.from({ length: 100 }, (_, index) => ({
          group: "Maximum plan",
          name: `Maximum category ${index}`,
          slug: `maximum-plan-${crypto.randomUUID()}`,
          userId,
        })),
      )
      .returning();
    const goalsForPlan = await database.db
      .insert(goals)
      .values(
        Array.from({ length: 25 }, (_, index) => ({ title: `Maximum goal ${index}`, userId })),
      )
      .returning();
    const setBudgetPlan = vi.fn(async () => ({ id: "maximum-plan" }));
    const service = createFinanceActionService({
      db: database.db,
      finances: { setBudgetPlan } as never,
      now: () => now,
    });
    const queued = await service.performDirect(
      "budget_plan",
      {
        allocations: categories.map((category) => ({ categoryId: category.id, limit: 1 })),
        assumptions: Array.from({ length: 25 }, (_, index) => `Maximum assumption ${index}`),
        goalIds: goalsForPlan.map((goal) => goal.id),
        month: "2026-12",
        rationale: "Exercise the bounded plan-review envelope.",
        replace: true,
        scenarioFingerprint: null,
      },
      { principal: agent(userId), requestId: "maximum-budget-plan" },
    );
    if (queued.status !== "pending_review") throw new Error("Expected a pending Finance review.");
    const revision = queued.review.expectedRevision;
    if (!revision) throw new Error("Expected a bounded revision.");
    expect(revision).toHaveLength(64);
    expect(revision.length).toBeLessThanOrEqual(128);
    await expect(
      service.approve(queued.review.id, {
        principal: user(userId),
        requestId: "maximum-budget-plan-approve",
      }),
    ).resolves.toMatchObject({ result: { id: "maximum-plan" }, status: "applied" });
    expect(setBudgetPlan).toHaveBeenCalledOnce();
  });

  it("queues, revalidates, and atomically approves a two-item evidence-backed categorization batch", async () => {
    await database.db
      .insert(financeAutomationSettings)
      .values({ reviewBypassEnabled: false, userId })
      .onConflictDoUpdate({
        set: { reviewBypassEnabled: false, updatedAt: now },
        target: financeAutomationSettings.userId,
      });
    const [account] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "Batch evidence bank",
        name: "Batch evidence checking",
        provider: "manual",
        status: "manual",
        userId,
      })
      .returning();
    const categories = await database.db
      .insert(financeCategories)
      .values([
        {
          group: "Batch evidence",
          name: "Batch groceries",
          slug: `batch-groceries-${crypto.randomUUID()}`,
          userId,
        },
        {
          group: "Batch evidence",
          name: "Batch transport",
          slug: `batch-transport-${crypto.randomUUID()}`,
          userId,
        },
      ])
      .returning();
    const merchants = await database.db
      .insert(financeMerchants)
      .values([
        {
          displayName: "Batch food vendor",
          normalizedName: `batch-grocery-${crypto.randomUUID()}`,
          userId,
        },
        {
          displayName: "Batch city vendor",
          normalizedName: `batch-transport-${crypto.randomUUID()}`,
          userId,
        },
      ])
      .returning();
    if (!account || categories.length !== 2 || merchants.length !== 2)
      throw new Error("Batch categorization fixtures were not created.");
    const [groceryCategory, transportCategory] = categories;
    const [foodMerchant, cityMerchant] = merchants;
    if (!groceryCategory || !transportCategory || !foodMerchant || !cityMerchant)
      throw new Error("Batch categorization fixtures were not created.");
    const transactions = await database.db
      .insert(financeTransactions)
      .values([
        {
          accountId: account.id,
          amount: 100,
          direction: "expense",
          merchant: foodMerchant.displayName,
          merchantId: foodMerchant.id,
          transactionDate: "2026-12-01",
          userId,
        },
        {
          accountId: account.id,
          amount: 101,
          direction: "expense",
          merchant: cityMerchant.displayName,
          merchantId: cityMerchant.id,
          transactionDate: "2026-12-02",
          userId,
        },
      ])
      .returning();
    if (transactions.length !== 2) throw new Error("Batch transactions were not created.");
    const [groceryTransaction, transportTransaction] = transactions;
    if (!groceryTransaction || !transportTransaction)
      throw new Error("Batch transactions were not created.");
    await database.db.insert(financeClassificationDecisions).values([
      ...Array.from({ length: 2 }, () => ({
        categoryId: groceryCategory.id,
        categoryName: groceryCategory.name,
        confidence: 10_000,
        merchantId: foodMerchant.id,
        outcome: "confirmed" as const,
        source: "user" as const,
        transactionId: groceryTransaction.id,
        userId,
      })),
      ...Array.from({ length: 2 }, () => ({
        categoryId: transportCategory.id,
        categoryName: transportCategory.name,
        confidence: 10_000,
        merchantId: cityMerchant.id,
        outcome: "confirmed" as const,
        source: "user" as const,
        transactionId: transportTransaction.id,
        userId,
      })),
    ]);
    const input = {
      decisions: [
        {
          categoryId: groceryCategory.id,
          confidence: 0.965,
          expectedTransactionUpdatedAt: groceryTransaction.updatedAt.toISOString(),
          learnMerchant: "suggest" as const,
          rationale: "Two user confirmations support this categorization.",
          transactionId: groceryTransaction.id,
        },
        {
          categoryId: transportCategory.id,
          confidence: 0.965,
          expectedTransactionUpdatedAt: transportTransaction.updatedAt.toISOString(),
          learnMerchant: "suggest" as const,
          rationale: "Two user confirmations support this categorization.",
          transactionId: transportTransaction.id,
        },
      ],
    };
    const service = createFinanceActionService({
      db: database.db,
      finances: createFinanceService({ db: database.db, now: () => now }),
      now: () => now,
    });

    const queued = await service.performDirect("categorization", input, {
      principal: agent(userId),
      requestId: "two-item-categorization-queue",
    });
    if (queued.status !== "pending_review") throw new Error("Expected a pending review.");
    expect(queued.review.expectedRevision?.length ?? 0).toBeGreaterThan(0);
    expect(queued.review.expectedRevision?.length ?? 0).toBeLessThanOrEqual(128);
    expect(queued.review.changes).toHaveLength(2);
    expect(queued.review.changes.length).toBeLessThanOrEqual(100);
    expect(queued.review.sourceRefs).toHaveLength(2);
    expect(queued.review.sourceRefs.length).toBeLessThanOrEqual(100);
    expect(queued.review).not.toHaveProperty("privatePayload");

    await expect(
      service.approve(queued.review.id, {
        principal: user(userId),
        requestId: "two-item-categorization-approve",
      }),
    ).resolves.toMatchObject({ status: "applied" });
    await expect(
      database.db
        .select({
          categoryId: financeTransactions.categoryId,
          category: financeTransactions.category,
        })
        .from(financeTransactions)
        .where(eq(financeTransactions.id, groceryTransaction.id)),
    ).resolves.toEqual([{ categoryId: groceryCategory.id, category: groceryCategory.name }]);
    await expect(
      database.db
        .select({
          categoryId: financeTransactions.categoryId,
          category: financeTransactions.category,
        })
        .from(financeTransactions)
        .where(eq(financeTransactions.id, transportTransaction.id)),
    ).resolves.toEqual([{ categoryId: transportCategory.id, category: transportCategory.name }]);
    await expect(
      database.db
        .select({ status: financeAgentActionReviews.status })
        .from(financeAgentActionReviews)
        .where(eq(financeAgentActionReviews.id, queued.review.id)),
    ).resolves.toEqual([{ status: "applied" }]);
  });

  it("queues a maximum-size categorization review with bounded public evidence", async () => {
    await database.db
      .insert(financeAutomationSettings)
      .values({ reviewBypassEnabled: false, userId })
      .onConflictDoUpdate({
        set: { reviewBypassEnabled: false, updatedAt: now },
        target: financeAutomationSettings.userId,
      });
    const [account] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "Maximum categorization bank",
        name: "Maximum categorization checking",
        provider: "manual",
        status: "manual",
        userId,
      })
      .returning();
    const [category] = await database.db
      .insert(financeCategories)
      .values({
        group: "Maximum categorization",
        name: "Maximum categorization category",
        slug: `maximum-categorization-${crypto.randomUUID()}`,
        userId,
      })
      .returning();
    if (!account || !category) throw new Error("Maximum categorization fixtures were not created.");
    const transactions = await database.db
      .insert(financeTransactions)
      .values(
        Array.from({ length: 100 }, (_, index) => ({
          accountId: account.id,
          amount: index + 1,
          direction: "expense" as const,
          merchant: `Maximum vendor ${index}`,
          transactionDate: "2026-12-04",
          userId,
        })),
      )
      .returning();
    const validatePreparedCategorizations = vi.fn(async () => true);
    const service = createFinanceActionService({
      db: database.db,
      finances: { validatePreparedCategorizations } as never,
      now: () => now,
    });

    const queued = await service.performDirect(
      "categorization",
      {
        decisions: transactions.map((transaction) => ({
          categoryId: category.id,
          confidence: 1,
          expectedTransactionUpdatedAt: transaction.updatedAt.toISOString(),
          learnMerchant: "suggest" as const,
          rationale: "Exercise the bounded categorization review envelope.",
          transactionId: transaction.id,
        })),
      },
      { principal: agent(userId), requestId: "maximum-categorization-queue" },
    );
    if (queued.status !== "pending_review") throw new Error("Expected a pending review.");
    expect(validatePreparedCategorizations).toHaveBeenCalledTimes(2);
    expect(queued.review.expectedRevision).toHaveLength(64);
    expect(queued.review.expectedRevision?.length ?? 0).toBeLessThanOrEqual(128);
    expect(queued.review.changes).toHaveLength(100);
    expect(queued.review.sourceRefs).toHaveLength(100);
    expect(queued.review).not.toHaveProperty("privatePayload");
  });

  it("queues and approves a merchant merge when selected rows sort target before source", async () => {
    await database.db
      .insert(financeAutomationSettings)
      .values({ reviewBypassEnabled: false, userId })
      .onConflictDoUpdate({
        set: { reviewBypassEnabled: false, updatedAt: now },
        target: financeAutomationSettings.userId,
      });
    const merchants = await database.db
      .insert(financeMerchants)
      .values([
        {
          displayName: "Merge candidate A",
          normalizedName: `merge-candidate-a-${crypto.randomUUID()}`,
          userId,
        },
        {
          displayName: "Merge candidate B",
          normalizedName: `merge-candidate-b-${crypto.randomUUID()}`,
          userId,
        },
      ])
      .returning();
    if (merchants.length !== 2) throw new Error("Merchant merge fixtures were not created.");
    const [target, source] = [...merchants].sort((left, right) => left.id.localeCompare(right.id));
    if (!source || !target) throw new Error("Merchant merge ordering fixtures were not created.");
    const [account] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "Merge test bank",
        name: "Merge test checking",
        provider: "manual",
        status: "manual",
        userId,
      })
      .returning();
    if (!account) throw new Error("Merchant merge account was not created.");
    const [transaction] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: account.id,
        amount: 100,
        direction: "expense",
        merchant: source.displayName,
        merchantId: source.id,
        transactionDate: "2026-12-03",
        userId,
      })
      .returning();
    if (!transaction) throw new Error("Merchant merge transaction was not created.");
    const service = createFinanceActionService({
      db: database.db,
      finances: createFinanceService({ db: database.db, now: () => now }),
      now: () => now,
    });

    const queued = await service.performDirect(
      "merchant",
      {
        rationale: "Consolidate duplicate merchant records.",
        sourceMerchantId: source.id,
        targetMerchantId: target.id,
      },
      { principal: agent(userId), requestId: "merchant-merge-reversed-order" },
    );
    if (queued.status !== "pending_review") throw new Error("Expected a pending review.");
    expect(source.id > target.id).toBe(true);
    expect(queued.review.changes[0]?.summary).toBe(
      `Merge ${source.displayName} into ${target.displayName}.`,
    );
    expect(queued.review.expectedRevision?.length ?? 0).toBeLessThanOrEqual(128);
    expect(queued.review.sourceRefs).toHaveLength(2);
    expect(queued.review.changes).toHaveLength(1);

    await expect(
      service.approve(queued.review.id, {
        principal: user(userId),
        requestId: "merchant-merge-reversed-order-approve",
      }),
    ).resolves.toMatchObject({ result: { id: target.id }, status: "applied" });
    await expect(
      database.db
        .select({ merchantId: financeTransactions.merchantId })
        .from(financeTransactions)
        .where(eq(financeTransactions.id, transaction.id)),
    ).resolves.toEqual([{ merchantId: target.id }]);
    await expect(
      database.db
        .select({ id: financeMerchants.id })
        .from(financeMerchants)
        .where(eq(financeMerchants.id, source.id)),
    ).resolves.toEqual([]);
  });

  it("asks only for the failed prerequisite and accepts its correction across every action family", async () => {
    await database.db
      .insert(financeAutomationSettings)
      .values({ reviewBypassEnabled: true, userId })
      .onConflictDoUpdate({
        set: { reviewBypassEnabled: true, updatedAt: now },
        target: financeAutomationSettings.userId,
      });
    const [foreignUser] = await database.db
      .insert(users)
      .values({
        displayName: "Question descriptor foreign owner",
        email: `question-descriptor-${crypto.randomUUID()}@example.com`,
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!foreignUser) throw new Error("Question descriptor foreign owner was not created.");
    const owned = await seedActionCases(
      database,
      userId,
      `Descriptor owned ${crypto.randomUUID()}`,
    );
    const foreign = await seedActionCases(
      database,
      foreignUser.id,
      `Descriptor foreign ${crypto.randomUUID()}`,
    );
    const service = createFinanceActionService({
      db: database.db,
      finances: {
        applyCategorizations: vi.fn(async () => []),
        createBudget: vi.fn(async () => ({})),
        createTransaction: vi.fn(async () => ({})),
        resolveAlert: vi.fn(async () => ({})),
        setBudgetPlan: vi.fn(async () => ({})),
        setTransactionBreakdown: vi.fn(async () => ({})),
        updateIncomeStream: vi.fn(async () => ({})),
        updateMerchant: vi.fn(async () => ({})),
        updateProfile: vi.fn(async () => ({})),
        updateRecurringObligation: vi.fn(async () => ({})),
        updateTransaction: vi.fn(async () => ({})),
        validatePreparedCategorizations: vi.fn(async () => true),
      } as never,
      now: () => now,
    });
    const ownedByKind = new Map(owned.map((item) => [item.actionKind, item]));
    const ownedProfile = ownedByKind.get("profile");
    const ownedBudget = ownedByKind.get("budget_plan");
    const ownedCategorization = ownedByKind.get("categorization");
    const ownedMerchant = ownedByKind.get("merchant");
    const ownedRecurring = ownedByKind.get("recurring_obligation");
    const ownedAlert = ownedByKind.get("alert");
    const ownedTransaction = ownedByKind.get("transaction");
    const ownedBreakdown = ownedByKind.get("transaction_breakdown");
    const ownedIncome = ownedByKind.get("income_stream");
    const foreignProfile = foreign.find((item) => item.actionKind === "profile");
    if (
      !ownedProfile ||
      !ownedBudget ||
      !ownedCategorization ||
      !ownedMerchant ||
      !ownedRecurring ||
      !ownedAlert ||
      !ownedTransaction ||
      !ownedBreakdown ||
      !ownedIncome ||
      !foreignProfile
    )
      throw new Error("Question descriptor fixtures were not created.");
    const descriptor = new Map<
      SupportedActionKind,
      { fields: string[]; patch: ActionCase["input"] }
    >([
      [
        "profile",
        { fields: ["payAccountId"], patch: { payAccountId: ownedProfile.input.payAccountId } },
      ],
      [
        "budget_plan",
        { fields: ["allocations"], patch: { allocations: ownedBudget.input.allocations } },
      ],
      [
        "categorization",
        { fields: ["decisions"], patch: { decisions: ownedCategorization.input.decisions } },
      ],
      ["merchant", { fields: ["id"], patch: { id: ownedMerchant.input.id } }],
      ["recurring_obligation", { fields: ["id"], patch: { id: ownedRecurring.input.id } }],
      ["alert", { fields: ["id"], patch: { id: ownedAlert.input.id } }],
      ["transaction", { fields: ["id"], patch: { id: ownedTransaction.input.id } }],
      ["transaction_breakdown", { fields: ["id"], patch: { id: ownedBreakdown.input.id } }],
      ["income_stream", { fields: ["id"], patch: { id: ownedIncome.input.id } }],
    ]);

    for (const foreignCase of foreign) {
      const expected = descriptor.get(foreignCase.actionKind);
      if (!expected) throw new Error("Question descriptor case was not configured.");
      const input =
        foreignCase.actionKind === "transaction_breakdown"
          ? { ...ownedBreakdown.input, id: foreignCase.foreignInput.id }
          : foreignCase.foreignInput;
      const asked = await service.performDirect(foreignCase.actionKind, input, {
        principal: agent(userId),
        requestId: `question-descriptor-${foreignCase.actionKind}`,
      });
      if (asked.status !== "needs_input")
        throw new Error("Expected a recoverable Finance question.");
      expect(asked.question.expectedAnswer.map((field) => field.name)).toEqual(expected.fields);
      await expect(
        service.answerQuestion(asked.question.id, JSON.stringify(expected.patch), {
          principal: agent(userId),
          requestId: `question-descriptor-answer-${foreignCase.actionKind}`,
        }),
      ).resolves.toMatchObject({ status: "applied" });
    }

    const [foreignGoal] = await database.db
      .insert(goals)
      .values({ title: "Foreign descriptor goal", userId: foreignUser.id })
      .returning();
    if (!foreignGoal) throw new Error("Foreign descriptor goal was not created.");
    const extraCases = [
      {
        actionKind: "profile" as const,
        fields: ["grossAnnualIncome"],
        input: { effectiveDate: "2026-12-03", grossAnnualIncome: "invalid" },
        patch: { grossAnnualIncome: 75_000 },
      },
      {
        actionKind: "budget_plan" as const,
        fields: ["goalIds"],
        input: { ...ownedBudget.input, goalIds: [foreignGoal.id] },
        patch: { goalIds: [] },
      },
      {
        actionKind: "categorization" as const,
        fields: ["decisions"],
        input: {
          decisions: (ownedCategorization.input.decisions as Array<Record<string, unknown>>).map(
            (decision) => ({
              ...decision,
              expectedTransactionUpdatedAt: "2020-01-01T00:00:00.000Z",
            }),
          ),
        },
        patch: { decisions: ownedCategorization.input.decisions },
      },
      {
        actionKind: "transaction" as const,
        fields: ["accountId"],
        input: {
          accountId: foreignProfile.input.payAccountId,
          amount: 1,
          date: "2026-09-01",
          direction: "expense",
          merchant: "Descriptor account correction",
        },
        patch: { accountId: ownedProfile.input.payAccountId },
      },
      {
        actionKind: "transaction" as const,
        fields: ["notes"],
        input: { id: ownedTransaction.input.id, notes: 42 },
        patch: { notes: "Corrected descriptor note." },
      },
    ];
    for (const item of extraCases) {
      const asked = await service.performDirect(item.actionKind, item.input, {
        principal: agent(userId),
        requestId: `question-descriptor-extra-${item.fields[0]}`,
      });
      if (asked.status !== "needs_input")
        throw new Error("Expected a recoverable Finance question.");
      expect(asked.question.expectedAnswer.map((field) => field.name)).toEqual(item.fields);
      await expect(
        service.answerQuestion(asked.question.id, JSON.stringify(item.patch), {
          principal: agent(userId),
          requestId: `question-descriptor-extra-answer-${item.fields[0]}`,
        }),
      ).resolves.toMatchObject({ status: "applied" });
    }

    await database.db.insert(financeProfiles).values({
      effectiveDate: "2026-08-01",
      expectedNetPay: 500,
      payFrequency: "monthly",
      userId,
    });
    const capacityAsked = await service.performDirect("budget_plan", ownedBudget.input, {
      principal: agent(userId),
      requestId: "question-descriptor-capacity",
    });
    if (capacityAsked.status !== "needs_input") throw new Error("Expected a capacity question.");
    expect(capacityAsked.question.expectedAnswer.map((field) => field.name)).toEqual([
      "acknowledgeOverAllocation",
    ]);
    await expect(
      service.answerQuestion(
        capacityAsked.question.id,
        JSON.stringify({ acknowledgeOverAllocation: true }),
        { principal: agent(userId), requestId: "question-descriptor-capacity-answer" },
      ),
    ).resolves.toMatchObject({ status: "applied" });
  });

  it("reuses a pending question only for the same requesting agent", async () => {
    const service = createFinanceActionService({
      db: database.db,
      finances: { updateProfile: vi.fn() } as never,
      now: () => now,
    });
    const input = { effectiveDate: "2026-12-04", grossAnnualIncome: "invalid" };
    const first = await service.performDirect("profile", input, {
      principal: agent(userId, "question-agent-one"),
      requestId: "question-fingerprint-first",
    });
    const repeated = await service.performDirect("profile", input, {
      principal: agent(userId, "question-agent-one"),
      requestId: "question-fingerprint-repeat",
    });
    const independent = await service.performDirect("profile", input, {
      principal: agent(userId, "question-agent-two"),
      requestId: "question-fingerprint-independent",
    });
    if (
      first.status !== "needs_input" ||
      repeated.status !== "needs_input" ||
      independent.status !== "needs_input"
    )
      throw new Error("Expected recoverable Finance questions.");
    expect(repeated.question.id).toBe(first.question.id);
    expect(independent.question.id).not.toBe(first.question.id);
  });

  it("requires agent transaction categories to satisfy categorization evidence before applying", async () => {
    await database.db
      .insert(financeAutomationSettings)
      .values({ reviewBypassEnabled: true, userId })
      .onConflictDoUpdate({
        set: { reviewBypassEnabled: true, updatedAt: now },
        target: financeAutomationSettings.userId,
      });
    const [account] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "Transaction authority bank",
        name: "Transaction authority checking",
        provider: "manual",
        status: "manual",
        userId,
      })
      .returning();
    const [category] = await database.db
      .insert(financeCategories)
      .values({
        group: "Test",
        name: "Transaction authority category",
        slug: `transaction-authority-${crypto.randomUUID()}`,
        userId,
      })
      .returning();
    const [merchant] = await database.db
      .insert(financeMerchants)
      .values({
        displayName: "Authority Grocer",
        normalizedName: `authority-grocer-${crypto.randomUUID()}`,
        userId,
      })
      .returning();
    if (!account || !category || !merchant) throw new Error("Authority fixtures were not created.");
    const [transaction] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: account.id,
        amount: 600,
        direction: "expense",
        merchant: "Authority Grocer",
        merchantId: merchant.id,
        transactionDate: "2026-08-17",
        userId,
      })
      .returning();
    if (!transaction) throw new Error("Authority transaction was not created.");
    const service = createFinanceActionService({
      db: database.db,
      finances: createFinanceService({ db: database.db, now: () => now }),
      now: () => now,
    });

    await expect(
      service.performDirect(
        "transaction",
        {
          category: category.name,
          confidence: 0.1,
          expectedTransactionUpdatedAt: transaction.updatedAt.toISOString(),
          id: transaction.id,
          rationale: "One weak observation is not enough evidence.",
        },
        { principal: agent(userId), requestId: "agent-transaction-low-confidence" },
      ),
    ).resolves.toMatchObject({ status: "needs_input" });
    await database.db
      .update(financeTransactions)
      .set({ reconciliationStatus: "candidate" })
      .where(eq(financeTransactions.id, transaction.id));
    await expect(
      service.performDirect(
        "transaction",
        {
          category: category.name,
          confidence: 0.965,
          expectedTransactionUpdatedAt: transaction.updatedAt.toISOString(),
          id: transaction.id,
          rationale: "Evidence cannot override an ambiguous transfer.",
        },
        { principal: agent(userId), requestId: "agent-transaction-candidate-transfer" },
      ),
    ).resolves.toMatchObject({ status: "needs_input" });
    await database.db
      .update(financeTransactions)
      .set({ reconciliationStatus: "not_applicable", updatedAt: transaction.updatedAt })
      .where(eq(financeTransactions.id, transaction.id));
    await database.db.insert(financeClassificationDecisions).values([
      {
        categoryId: category.id,
        categoryName: category.name,
        confidence: 10_000,
        merchantId: merchant.id,
        outcome: "confirmed",
        rationale: "Person-confirmed authority evidence.",
        source: "user",
        transactionId: transaction.id,
        userId,
      },
      {
        categoryId: category.id,
        categoryName: category.name,
        confidence: 10_000,
        merchantId: merchant.id,
        outcome: "confirmed",
        rationale: "Second person-confirmed authority evidence.",
        source: "user",
        transactionId: transaction.id,
        userId,
      },
    ]);
    const rationale = "Two confirmed observations support a permanent rule.";
    await expect(
      service.performDirect(
        "transaction",
        {
          category: category.name,
          confidence: 0.965,
          expectedTransactionUpdatedAt: transaction.updatedAt.toISOString(),
          id: transaction.id,
          learnMerchant: true,
          rationale,
        },
        { principal: agent(userId), requestId: "agent-transaction-permanent-rule" },
      ),
    ).resolves.toMatchObject({ status: "applied" });
    await expect(
      database.db
        .select({
          categoryRationale: financeTransactions.categoryRationale,
          categorySource: financeTransactions.categorySource,
        })
        .from(financeTransactions)
        .where(eq(financeTransactions.id, transaction.id)),
    ).resolves.toEqual([{ categoryRationale: rationale, categorySource: "agent" }]);
  });

  it("applies server-validated merchant-rule transaction updates through bypass and human approval", async () => {
    const [account] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "Merchant rule basis bank",
        name: "Merchant rule basis checking",
        provider: "manual",
        status: "manual",
        userId,
      })
      .returning();
    const [category] = await database.db
      .insert(financeCategories)
      .values({
        group: "Merchant rule basis",
        name: "Merchant rule basis category",
        slug: `merchant-rule-basis-${crypto.randomUUID()}`,
        userId,
      })
      .returning();
    if (!account || !category) throw new Error("Merchant rule basis fixtures were not created.");
    await database.db.insert(financeCategoryRules).values({
      category: category.name,
      merchantNormalized: "merchant rule vendor",
      userId,
    });
    const transactions = await database.db
      .insert(financeTransactions)
      .values([
        {
          accountId: account.id,
          amount: 1200,
          direction: "expense",
          merchant: "Merchant Rule Vendor #1234",
          transactionDate: "2026-12-13",
          userId,
        },
        {
          accountId: account.id,
          amount: 3400,
          direction: "expense",
          merchant: "Merchant Rule Vendor #5678",
          transactionDate: "2026-12-14",
          userId,
        },
      ])
      .returning();
    if (transactions.length !== 2)
      throw new Error("Merchant rule basis transactions were not created.");
    const [bypassTransaction, approvalTransaction] = transactions;
    if (!bypassTransaction || !approvalTransaction)
      throw new Error("Merchant rule basis transactions were not created.");
    const service = createFinanceActionService({
      db: database.db,
      finances: createFinanceService({ db: database.db, now: () => now }),
      now: () => now,
    });
    const proposal = (transaction: (typeof transactions)[number]) => ({
      category: category.name,
      confidence: 1,
      expectedTransactionUpdatedAt: transaction.updatedAt.toISOString(),
      id: transaction.id,
      rationale: "The approved merchant rule matches this transaction.",
      suggestionBasis: "merchant_rule" as const,
    });
    await database.db
      .update(financeAutomationSettings)
      .set({ reviewBypassEnabled: true, updatedAt: now })
      .where(eq(financeAutomationSettings.userId, userId));
    const bypass = await service.performDirect("transaction", proposal(bypassTransaction), {
      principal: agent(userId),
      requestId: "merchant-rule-bypass",
    });
    expect(bypass).toMatchObject({ status: "applied" });
    await expect(
      database.db
        .select({ categorySource: financeTransactions.categorySource })
        .from(financeTransactions)
        .where(eq(financeTransactions.id, bypassTransaction.id)),
    ).resolves.toEqual([{ categorySource: "rule" }]);

    await database.db
      .update(financeAutomationSettings)
      .set({ reviewBypassEnabled: false, updatedAt: now })
      .where(eq(financeAutomationSettings.userId, userId));
    const queued = await service.performDirect("transaction", proposal(approvalTransaction), {
      principal: agent(userId),
      requestId: "merchant-rule-queue",
    });
    if (queued.status !== "pending_review") throw new Error("Expected a pending Finance review.");
    await expect(
      service.approve(queued.review.id, {
        principal: user(userId),
        requestId: "merchant-rule-approve",
      }),
    ).resolves.toMatchObject({ status: "applied" });
    await expect(
      database.db
        .select({ categorySource: financeTransactions.categorySource })
        .from(financeTransactions)
        .where(eq(financeTransactions.id, approvalTransaction.id)),
    ).resolves.toEqual([{ categorySource: "rule" }]);
    await expect(
      database.db
        .select({ actorId: auditEvents.actorId, actorType: auditEvents.actorType })
        .from(auditEvents)
        .where(eq(auditEvents.requestId, "merchant-rule-approve")),
    ).resolves.toContainEqual({ actorId: "finance-agent", actorType: "agent" });

    const [withoutRule] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: account.id,
        amount: 5600,
        direction: "expense",
        merchant: "Merchant Rule Missing Vendor",
        transactionDate: "2026-12-15",
        userId,
      })
      .returning();
    if (!withoutRule) throw new Error("Missing merchant rule transaction was not created.");
    await expect(
      service.performDirect(
        "transaction",
        {
          ...proposal(withoutRule),
          suggestionBasis: "merchant_rule",
        },
        { principal: agent(userId), requestId: "merchant-rule-missing" },
      ),
    ).resolves.toMatchObject({ status: "needs_input" });
  });

  it("resumes a human answer with the requesting agent authority and audits the responder", async () => {
    await database.db
      .insert(financeAutomationSettings)
      .values({ reviewBypassEnabled: false, userId })
      .onConflictDoUpdate({
        set: { reviewBypassEnabled: false, updatedAt: now },
        target: financeAutomationSettings.userId,
      });
    const [account] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "Responder bank",
        name: "Responder checking",
        provider: "manual",
        status: "manual",
        userId,
      })
      .returning();
    if (!account) throw new Error("Responder account was not created.");
    const asked = await createFinanceActionService({
      db: database.db,
      finances: createFinanceService({ db: database.db, now: () => now }),
      now: () => now,
    }).performDirect(
      "profile",
      {
        effectiveDate: "2026-08-17",
        employer: "Responder employer",
        payAccountId: "00000000-0000-4000-8000-000000000000",
      },
      { principal: agent(userId), requestId: "agent-asks-question" },
    );
    if (asked.status !== "needs_input") throw new Error("Expected an agent question.");
    const service = createFinanceActionService({
      db: database.db,
      finances: createFinanceService({ db: database.db, now: () => now }),
      now: () => now,
    });
    await expect(
      service.answerQuestion(asked.question.id, JSON.stringify({ payAccountId: account.id }), {
        principal: user(userId),
        requestId: "human-supplies-evidence",
      }),
    ).resolves.toMatchObject({ status: "pending_review" });
    await expect(
      database.db
        .select({
          action: auditEvents.action,
          actorId: auditEvents.actorId,
          actorType: auditEvents.actorType,
        })
        .from(auditEvents)
        .where(eq(auditEvents.entityId, asked.question.id)),
    ).resolves.toContainEqual(
      expect.objectContaining({
        action: "finance.question_answered",
        actorId: userId,
        actorType: "user",
      }),
    );
    await database.db
      .update(financeAutomationSettings)
      .set({ reviewBypassEnabled: true, updatedAt: now })
      .where(eq(financeAutomationSettings.userId, userId));
    const secondQuestion = await service.performDirect(
      "profile",
      {
        effectiveDate: "2026-08-18",
        employer: "Responder employer",
        payAccountId: "00000000-0000-4000-8000-000000000000",
      },
      { principal: agent(userId), requestId: "agent-asks-question-bypass-on" },
    );
    if (secondQuestion.status !== "needs_input")
      throw new Error("Expected a second agent question.");
    await expect(
      service.answerQuestion(
        secondQuestion.question.id,
        JSON.stringify({ payAccountId: account.id }),
        {
          principal: user(userId),
          requestId: "human-supplies-evidence-bypass-on",
        },
      ),
    ).resolves.toMatchObject({ status: "applied" });
  });

  it("resolves a maintenance expense reimbursement answer through the bounded answer object", async () => {
    await database.db
      .update(financeAutomationSettings)
      .set({ reviewBypassEnabled: true, updatedAt: now })
      .where(eq(financeAutomationSettings.userId, userId));
    const [account] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "Question reimbursement bank",
        name: "Question reimbursement checking",
        provider: "manual",
        status: "manual",
        userId,
      })
      .returning();
    const [category] = await database.db
      .insert(financeCategories)
      .values({
        group: "Spending",
        name: "Dining",
        slug: `question-reimbursement-${crypto.randomUUID()}`,
        userId,
      })
      .returning();
    if (!account || !category) throw new Error("Question reimbursement fixture failed.");
    const [expense] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: account.id,
        amount: 31_000,
        category: category.name,
        categoryId: category.id,
        direction: "expense",
        merchant: "Dinner House",
        transactionDate: "2026-08-17",
        userId,
      })
      .returning();
    if (!expense) throw new Error("Question reimbursement expense failed.");
    const [allocation] = await database.db
      .insert(financeTransactionAllocations)
      .values({
        allocationOrder: 0,
        amount: 31_000,
        categoryId: category.id,
        rationale: "Original dinner allocation",
        transactionId: expense.id,
        treatment: "personal",
        userId,
      })
      .returning();
    if (!allocation) throw new Error("Question reimbursement allocation failed.");
    const source = {
      accountId: account.id,
      provider: "local" as const,
      remoteId: expense.id,
      revision: expense.updatedAt.toISOString(),
      sourceType: "finance_transaction" as const,
    };
    const [stored] = await database.db
      .insert(financeAgentActionReviews)
      .values({
        actionKind: "question",
        expectedRevision: "maintenance-question",
        fingerprint: `maintenance-reimbursement-${crypto.randomUUID()}`,
        privatePayload: {
          candidate: { allocationIds: [allocation.id], transactionId: expense.id },
          maintenanceAnswerAuthority: "same_user_finances_write",
          original: { actionKind: "reimbursement", input: { operation: "answer_question" } },
          question: {
            actionKind: "reimbursement",
            choices: [],
            expectedAnswer: [{ name: "answer", required: true, type: "object" }],
            id: "pending",
            prompt: "Is this expense personal or reimbursable?",
            sourceRefs: [source],
            why: "Large dinner needs confirmation.",
          },
        },
        requestingAgentId: "finance-maintenance",
        safeChanges: [
          { entityId: expense.id, entityType: "finance_transaction", summary: "Classify expense." },
        ],
        semanticTargetKeys: [`transaction:${expense.id}`],
        sourceRefs: [source],
        userId,
      })
      .returning();
    if (!stored) throw new Error("Question reimbursement row failed.");
    const service = createFinanceActionService({
      db: database.db,
      finances: createFinanceService({ db: database.db, now: () => now }),
      now: () => now,
    });

    await expect(
      service.answerQuestion(
        stored.id,
        JSON.stringify({
          answer: {
            amount: 220,
            dueDate: null,
            kind: "reimbursable",
            payer: "Alex",
            rationale: "Alex agreed to pay their share.",
          },
        }),
        { principal: agent(userId, "maintenance-answerer"), requestId: "maintenance-answer" },
      ),
    ).resolves.toMatchObject({
      result: { personalAmount: 90, reimbursementAmount: 220 },
      status: "applied",
    });
    await expect(
      database.db
        .select({
          amount: financeTransactionAllocations.amount,
          treatment: financeTransactionAllocations.treatment,
        })
        .from(financeTransactionAllocations)
        .where(
          and(
            eq(financeTransactionAllocations.transactionId, expense.id),
            eq(financeTransactionAllocations.state, "active"),
          ),
        )
        .orderBy(financeTransactionAllocations.allocationOrder),
    ).resolves.toEqual([
      { amount: 9_000, treatment: "personal" },
      { amount: 22_000, treatment: "reimbursable" },
    ]);
    const cases = await database.db
      .select({
        expectedAmount: financeReimbursements.expectedAmount,
        payer: financeReimbursements.payer,
      })
      .from(financeReimbursements)
      .where(eq(financeReimbursements.userId, userId));
    expect(cases).toContainEqual({ expectedAmount: 22_000, payer: "Alex" });
    await expect(
      database.db
        .select({ status: financeAgentActionReviews.status })
        .from(financeAgentActionReviews)
        .where(eq(financeAgentActionReviews.id, stored.id)),
    ).resolves.toEqual([{ status: "superseded" }]);
    await expect(
      database.db
        .select({ id: financeReimbursementMatches.id })
        .from(financeReimbursementMatches)
        .where(eq(financeReimbursementMatches.userId, userId)),
    ).resolves.toEqual([]);
    const [currentExpense] = await database.db
      .select()
      .from(financeTransactions)
      .where(eq(financeTransactions.id, expense.id));
    const [activeReimbursableAllocation] = await database.db
      .select()
      .from(financeTransactionAllocations)
      .where(
        and(
          eq(financeTransactionAllocations.transactionId, expense.id),
          eq(financeTransactionAllocations.state, "active"),
          eq(financeTransactionAllocations.treatment, "reimbursable"),
        ),
      );
    if (!currentExpense || !activeReimbursableAllocation)
      throw new Error("Expected the active reimbursement case fixture.");
    const duplicateQuestion = await storeReimbursementQuestion(database, {
      accountId: account.id,
      candidate: {
        allocationIds: [activeReimbursableAllocation.id],
        transactionId: currentExpense.id,
      },
      transaction: currentExpense,
      userId,
    });
    await expect(
      service.answerQuestion(
        duplicateQuestion.id,
        JSON.stringify({
          answer: { kind: "entirely_personal", rationale: "Changed my mind." },
        }),
        { principal: agent(userId, "maintenance-answerer"), requestId: "active-case-personal" },
      ),
    ).resolves.toMatchObject({ question: { id: duplicateQuestion.id }, status: "needs_input" });
    await expect(
      database.db
        .select({ id: financeReimbursements.id })
        .from(financeReimbursements)
        .where(eq(financeReimbursements.allocationId, activeReimbursableAllocation.id)),
    ).resolves.toHaveLength(1);
  });

  it("keeps uncertain answers recoverable, records personal evidence, and queues bypass-off answers", async () => {
    const [account] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "Question choices bank",
        name: "Question choices checking",
        provider: "manual",
        status: "manual",
        userId,
      })
      .returning();
    const [category] = await database.db
      .insert(financeCategories)
      .values({
        group: "Spending",
        name: `Question choices ${crypto.randomUUID()}`,
        slug: `question-choices-${crypto.randomUUID()}`,
        userId,
      })
      .returning();
    if (!account || !category) throw new Error("Question choice fixture failed.");
    const createExpense = async (amount: number) => {
      const [transaction] = await database.db
        .insert(financeTransactions)
        .values({
          accountId: account.id,
          amount,
          category: category.name,
          categoryId: category.id,
          direction: "expense",
          merchant: "Question dinner",
          transactionDate: "2026-08-17",
          userId,
        })
        .returning();
      if (!transaction) throw new Error("Question choice expense failed.");
      const [allocation] = await database.db
        .insert(financeTransactionAllocations)
        .values({
          allocationOrder: 0,
          amount,
          categoryId: category.id,
          transactionId: transaction.id,
          treatment: "personal",
          userId,
        })
        .returning();
      if (!allocation) throw new Error("Question choice allocation failed.");
      return { allocation, transaction };
    };
    const service = createFinanceActionService({
      db: database.db,
      finances: createFinanceService({ db: database.db, now: () => now }),
      now: () => now,
    });
    await database.db
      .update(financeAutomationSettings)
      .set({ reviewBypassEnabled: true, updatedAt: now })
      .where(eq(financeAutomationSettings.userId, userId));

    const uncertain = await createExpense(10_000);
    const uncertainQuestion = await storeReimbursementQuestion(database, {
      accountId: account.id,
      candidate: {
        allocationIds: [uncertain.allocation.id],
        transactionId: uncertain.transaction.id,
      },
      transaction: uncertain.transaction,
      userId,
    });
    await expect(
      service.answerQuestion(
        uncertainQuestion.id,
        JSON.stringify({ answer: { kind: "not_sure" } }),
        { principal: agent(userId, "maintenance-answerer"), requestId: "uncertain-answer" },
      ),
    ).resolves.toMatchObject({ question: { id: uncertainQuestion.id }, status: "needs_input" });
    await expect(
      database.db
        .select({ status: financeAgentActionReviews.status })
        .from(financeAgentActionReviews)
        .where(eq(financeAgentActionReviews.id, uncertainQuestion.id)),
    ).resolves.toEqual([{ status: "pending" }]);
    const agentOwnedQuestion = await storeReimbursementQuestion(database, {
      accountId: account.id,
      candidate: {
        allocationIds: [uncertain.allocation.id],
        transactionId: uncertain.transaction.id,
      },
      maintenanceAnswerAuthority: false,
      requestingAgentId: "answer-owner",
      transaction: uncertain.transaction,
      userId,
    });
    await expect(
      service.answerQuestion(
        agentOwnedQuestion.id,
        JSON.stringify({ answer: { kind: "not_sure" } }),
        { principal: agent(userId, "other-agent"), requestId: "cross-agent-question" },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    const [otherUser] = await database.db
      .insert(users)
      .values({
        displayName: "Other reimbursement owner",
        email: `other-reimbursement-${crypto.randomUUID()}@example.com`,
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!otherUser) throw new Error("Cross-user fixture failed.");
    await expect(
      service.answerQuestion(
        agentOwnedQuestion.id,
        JSON.stringify({ answer: { kind: "not_sure" } }),
        { principal: agent(otherUser.id, "answer-owner"), requestId: "cross-user-question" },
      ),
    ).rejects.toMatchObject({ code: "not_found" });

    const personal = await createExpense(12_000);
    const personalQuestion = await storeReimbursementQuestion(database, {
      accountId: account.id,
      candidate: {
        allocationIds: [personal.allocation.id],
        transactionId: personal.transaction.id,
      },
      transaction: personal.transaction,
      userId,
    });
    const personalAnswer = JSON.stringify({
      answer: { kind: "entirely_personal", rationale: "This was my own meal." },
    });
    await expect(
      service.answerQuestion(personalQuestion.id, personalAnswer, {
        principal: agent(userId, "maintenance-answerer"),
        requestId: "personal-answer",
      }),
    ).resolves.toMatchObject({ result: { disposition: "entirely_personal" }, status: "applied" });
    await expect(
      service.answerQuestion(personalQuestion.id, personalAnswer, {
        principal: agent(userId, "maintenance-answerer"),
        requestId: "personal-answer-replay",
      }),
    ).resolves.toMatchObject({ result: { disposition: "entirely_personal" }, status: "applied" });
    await expect(
      service.answerQuestion(
        personalQuestion.id,
        JSON.stringify({ answer: { kind: "entirely_personal", rationale: "Changed answer." } }),
        { principal: agent(userId, "maintenance-answerer"), requestId: "personal-answer-change" },
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      database.db
        .select({ outcome: financeClassificationDecisions.outcome })
        .from(financeClassificationDecisions)
        .where(eq(financeClassificationDecisions.transactionId, personal.transaction.id)),
    ).resolves.toContainEqual({ outcome: "confirmed" });

    await database.db
      .update(financeAutomationSettings)
      .set({ reviewBypassEnabled: false, updatedAt: now })
      .where(eq(financeAutomationSettings.userId, userId));
    const queued = await createExpense(13_000);
    const queuedQuestion = await storeReimbursementQuestion(database, {
      accountId: account.id,
      candidate: { allocationIds: [queued.allocation.id], transactionId: queued.transaction.id },
      transaction: queued.transaction,
      userId,
    });
    const queuedOutcome = await service.answerQuestion(
      queuedQuestion.id,
      JSON.stringify({
        answer: {
          amount: 50,
          dueDate: null,
          kind: "reimbursable",
          payer: "Alex",
          rationale: "Alex owes part.",
        },
      }),
      { principal: agent(userId, "maintenance-answerer"), requestId: "queued-answer" },
    );
    if (queuedOutcome.status !== "pending_review" || !("review" in queuedOutcome))
      throw new Error("Expected a queued answer review.");
    await expect(
      service.approve(queuedOutcome.review.id, {
        principal: user(userId),
        requestId: "queued-approve",
      }),
    ).resolves.toMatchObject({ status: "applied" });
  });

  it("matches a partial combined credit and dismisses an unrelated credit without a match", async () => {
    await database.db
      .update(financeAutomationSettings)
      .set({ reviewBypassEnabled: true, updatedAt: now })
      .where(eq(financeAutomationSettings.userId, userId));
    const [account] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "Credit question bank",
        name: "Credit question checking",
        provider: "manual",
        status: "manual",
        userId,
      })
      .returning();
    const [category] = await database.db
      .insert(financeCategories)
      .values({
        group: "Spending",
        name: `Credit question ${crypto.randomUUID()}`,
        slug: `credit-question-${crypto.randomUUID()}`,
        userId,
      })
      .returning();
    if (!account || !category) throw new Error("Credit question fixture failed.");
    const createCase = async (amount: number) => {
      const [expense] = await database.db
        .insert(financeTransactions)
        .values({
          accountId: account.id,
          amount,
          category: category.name,
          categoryId: category.id,
          direction: "expense",
          merchant: "Shared dinner",
          transactionDate: "2026-08-17",
          userId,
        })
        .returning();
      if (!expense) throw new Error("Credit question expense failed.");
      const [allocation] = await database.db
        .insert(financeTransactionAllocations)
        .values({
          allocationOrder: 0,
          amount,
          categoryId: category.id,
          transactionId: expense.id,
          treatment: "reimbursable",
          userId,
        })
        .returning();
      if (!allocation) throw new Error("Credit question allocation failed.");
      const [reimbursement] = await database.db
        .insert(financeReimbursements)
        .values({
          allocationId: allocation.id,
          evidence: {
            sourceRefs: [
              {
                accountId: account.id,
                provider: "local",
                remoteId: expense.id,
                revision: expense.updatedAt.toISOString(),
                sourceType: "finance_transaction",
              },
            ],
            summary: "Shared dinner receipt",
          },
          expectedAmount: amount,
          payer: "Alex",
          rationale: "Alex owes a share.",
          userId,
        })
        .returning();
      if (!reimbursement) throw new Error("Credit question case failed.");
      return reimbursement;
    };
    const [first, second] = await Promise.all([createCase(6_000), createCase(8_000)]);
    const [credit] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: account.id,
        amount: 12_000,
        direction: "income",
        merchant: "Venmo Alex",
        transactionDate: "2026-08-18",
        userId,
      })
      .returning();
    if (!credit) throw new Error("Credit question credit failed.");
    const question = await storeReimbursementQuestion(database, {
      accountId: account.id,
      candidate: { reimbursementIds: [first.id, second.id], transactionId: credit.id },
      transaction: credit,
      userId,
    });
    const service = createFinanceActionService({
      db: database.db,
      finances: createFinanceService({ db: database.db, now: () => now }),
      now: () => now,
    });
    await expect(
      service.answerQuestion(
        question.id,
        JSON.stringify({
          answer: {
            kind: "match",
            matches: [
              { amount: 30, reimbursementId: first.id },
              { amount: 40, reimbursementId: second.id },
            ],
          },
        }),
        { principal: agent(userId, "maintenance-answerer"), requestId: "combined-credit" },
      ),
    ).resolves.toMatchObject({ result: { disposition: "match" }, status: "applied" });
    await expect(
      database.db
        .select({
          receivedAmount: financeReimbursements.receivedAmount,
          status: financeReimbursements.status,
        })
        .from(financeReimbursements)
        .where(inArray(financeReimbursements.id, [first.id, second.id]))
        .orderBy(financeReimbursements.expectedAmount),
    ).resolves.toEqual([
      { receivedAmount: 3_000, status: "partially_received" },
      { receivedAmount: 4_000, status: "partially_received" },
    ]);
    const [unrelated] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: account.id,
        amount: 2_500,
        direction: "income",
        merchant: "Venmo Alex unrelated",
        transactionDate: "2026-08-19",
        userId,
      })
      .returning();
    if (!unrelated) throw new Error("Unrelated credit failed.");
    const unrelatedQuestion = await storeReimbursementQuestion(database, {
      accountId: account.id,
      candidate: { reimbursementIds: [first.id], transactionId: unrelated.id },
      transaction: unrelated,
      userId,
    });
    await expect(
      service.answerQuestion(
        unrelatedQuestion.id,
        JSON.stringify({ answer: { kind: "not_reimbursement" } }),
        { principal: agent(userId, "maintenance-answerer"), requestId: "unrelated-credit" },
      ),
    ).resolves.toMatchObject({ result: { disposition: "not_reimbursement" }, status: "applied" });
    await expect(
      database.db
        .select({ creditTransactionId: financeReimbursementMatches.creditTransactionId })
        .from(financeReimbursementMatches)
        .where(eq(financeReimbursementMatches.creditTransactionId, unrelated.id)),
    ).resolves.toEqual([]);
  });

  it("serializes a typed credit answer with a direct signed-in reconciliation on the same case and credit", async () => {
    // If either writer stops locking the reimbursement case before its credit
    // work, this real PostgreSQL barrier can deadlock or persist two matches.
    await database.db
      .insert(financeAutomationSettings)
      .values({ reviewBypassEnabled: true, userId })
      .onConflictDoUpdate({
        set: { reviewBypassEnabled: true, updatedAt: now },
        target: financeAutomationSettings.userId,
      });
    const [account] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "Credit race bank",
        name: `Credit race ${crypto.randomUUID()}`,
        provider: "manual",
        status: "manual",
        userId,
      })
      .returning();
    const [category] = await database.db
      .insert(financeCategories)
      .values({
        group: "Spending",
        name: `Credit race ${crypto.randomUUID()}`,
        slug: `credit-race-${crypto.randomUUID()}`,
        userId,
      })
      .returning();
    if (!account || !category) throw new Error("Credit-race account/category fixture failed.");
    const [expense] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: account.id,
        amount: 22_000,
        category: category.name,
        categoryId: category.id,
        direction: "expense",
        merchant: "Credit race dinner",
        transactionDate: "2026-08-17",
        userId,
      })
      .returning();
    if (!expense) throw new Error("Credit-race expense fixture failed.");
    const [allocation] = await database.db
      .insert(financeTransactionAllocations)
      .values({
        allocationOrder: 0,
        amount: 22_000,
        categoryId: category.id,
        transactionId: expense.id,
        treatment: "reimbursable",
        userId,
      })
      .returning();
    if (!allocation) throw new Error("Credit-race allocation fixture failed.");
    const [reimbursement] = await database.db
      .insert(financeReimbursements)
      .values({
        allocationId: allocation.id,
        evidence: { sourceRefs: [], summary: "Credit race receipt" },
        expectedAmount: 22_000,
        payer: "Alex",
        rationale: "Credit race share",
        userId,
      })
      .returning();
    const [credit] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: account.id,
        amount: 22_000,
        direction: "income",
        merchant: "Venmo credit race",
        transactionDate: "2026-08-18",
        userId,
      })
      .returning();
    if (!reimbursement || !credit) throw new Error("Credit-race reimbursement fixture failed.");
    const question = await storeReimbursementQuestion(database, {
      accountId: account.id,
      candidate: { reimbursementIds: [reimbursement.id], transactionId: credit.id },
      transaction: credit,
      userId,
    });
    const contentionDatabase = createStatementTimedDatabase(container.getConnectionUri());
    const finances = createFinanceService({ db: contentionDatabase.db, now: () => now });
    const actions = createFinanceActionService({
      db: contentionDatabase.db,
      finances,
      now: () => now,
    });
    const blocker = await database.pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("SET LOCAL statement_timeout = '5s'");
      await blocker.query("SELECT id FROM finance_reimbursements WHERE id = $1 FOR UPDATE", [
        reimbursement.id,
      ]);
      const typedAnswer = actions.answerQuestion(
        question.id,
        JSON.stringify({
          answer: {
            kind: "match",
            matches: [{ amount: 220, reimbursementId: reimbursement.id }],
          },
        }),
        { principal: agent(userId, "maintenance-answerer"), requestId: "credit-race-question" },
      );
      const directReconciliation = finances.reconcileReimbursement(
        {
          amount: 220,
          creditTransactionId: credit.id,
          evidence: { sourceRefs: [], summary: "Signed-in credit reconciliation" },
          expectedRevision: reimbursement.revision,
          operation: "match_credit",
          rationale: "Signed-in reconciliation",
          reimbursementId: reimbursement.id,
        },
        { principal: user(userId), requestId: "credit-race-direct" },
      );
      await waitForLockWaiter(database.pool, "finance_reimbursements");
      await blocker.query("COMMIT");
      const outcomes = await settleWithoutDeadlock([typedAnswer, directReconciliation]);
      expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(true);
      expect(
        outcomes.every(
          (outcome) =>
            outcome.status === "fulfilled" ||
            (outcome.reason as { code?: string }).code === "conflict",
        ),
      ).toBe(true);
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
      await contentionDatabase.close();
    }
    await expect(
      database.db
        .select({ amount: financeReimbursementMatches.amount })
        .from(financeReimbursementMatches)
        .where(
          and(
            eq(financeReimbursementMatches.reimbursementId, reimbursement.id),
            eq(financeReimbursementMatches.creditTransactionId, credit.id),
          ),
        ),
    ).resolves.toEqual([{ amount: 22_000 }]);
    await expect(
      database.db
        .select({
          receivedAmount: financeReimbursements.receivedAmount,
          status: financeReimbursements.status,
        })
        .from(financeReimbursements)
        .where(eq(financeReimbursements.id, reimbursement.id)),
    ).resolves.toEqual([{ receivedAmount: 22_000, status: "received" }]);
    await expect(
      database.db
        .select({ state: financeTransactionAllocations.state })
        .from(financeTransactionAllocations)
        .where(eq(financeTransactionAllocations.id, allocation.id)),
    ).resolves.toEqual([{ state: "active" }]);
    const [questionReview] = await database.db
      .select({ status: financeAgentActionReviews.status })
      .from(financeAgentActionReviews)
      .where(eq(financeAgentActionReviews.id, question.id));
    expect(questionReview).toEqual(
      expect.objectContaining({ status: expect.stringMatching(/pending|superseded/) }),
    );
    const questionAudits = await database.db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.entityId, question.id),
          eq(auditEvents.action, "finance.question_answered"),
        ),
      );
    expect(questionAudits).toHaveLength(questionReview?.status === "superseded" ? 1 : 0);
  });

  it("serializes an expense reimbursement answer with a direct breakdown replacement", async () => {
    // The barrier lets either writer acquire the expense lock first; the other
    // must recover without deleting an allocation backing a reimbursement case.
    await database.db
      .insert(financeAutomationSettings)
      .values({ reviewBypassEnabled: true, userId })
      .onConflictDoUpdate({
        set: { reviewBypassEnabled: true, updatedAt: now },
        target: financeAutomationSettings.userId,
      });
    const [account] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "Expense race bank",
        name: `Expense race ${crypto.randomUUID()}`,
        provider: "manual",
        status: "manual",
        userId,
      })
      .returning();
    const [category] = await database.db
      .insert(financeCategories)
      .values({
        group: "Spending",
        name: `Expense race ${crypto.randomUUID()}`,
        slug: `expense-race-${crypto.randomUUID()}`,
        userId,
      })
      .returning();
    if (!account || !category) throw new Error("Expense-race account/category fixture failed.");
    const [expense] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: account.id,
        amount: 31_000,
        category: category.name,
        categoryId: category.id,
        direction: "expense",
        merchant: "Expense race dinner",
        transactionDate: "2026-08-17",
        userId,
      })
      .returning();
    if (!expense) throw new Error("Expense-race expense fixture failed.");
    const [allocation] = await database.db
      .insert(financeTransactionAllocations)
      .values({
        allocationOrder: 0,
        amount: 31_000,
        categoryId: category.id,
        transactionId: expense.id,
        treatment: "personal",
        userId,
      })
      .returning();
    if (!allocation) throw new Error("Expense-race allocation fixture failed.");
    const question = await storeReimbursementQuestion(database, {
      accountId: account.id,
      candidate: { allocationIds: [allocation.id], transactionId: expense.id },
      transaction: expense,
      userId,
    });
    const contentionDatabase = createStatementTimedDatabase(container.getConnectionUri());
    const finances = createFinanceService({ db: contentionDatabase.db, now: () => now });
    const actions = createFinanceActionService({
      db: contentionDatabase.db,
      finances,
      now: () => now,
    });
    const blocker = await database.pool.connect();
    let typedAnswerApplied = false;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SET LOCAL statement_timeout = '5s'");
      await blocker.query("SELECT id FROM finance_transactions WHERE id = $1 FOR UPDATE", [
        expense.id,
      ]);
      const typedAnswer = actions.answerQuestion(
        question.id,
        JSON.stringify({
          answer: {
            amount: 220,
            dueDate: null,
            kind: "reimbursable",
            payer: "Alex",
            rationale: "Alex owes the shared portion.",
          },
        }),
        { principal: agent(userId, "maintenance-answerer"), requestId: "expense-race-question" },
      );
      const replacement = finances.setTransactionBreakdown(
        expense.id,
        {
          allocations: [
            { amount: 310, categoryId: category.id, rationale: "Personal replacement" },
          ],
          expectedTransactionUpdatedAt: expense.updatedAt.toISOString(),
          rationale: "Direct signed-in replacement",
        },
        { principal: user(userId), requestId: "expense-race-direct" },
      );
      await waitForLockWaiter(database.pool, "finance_transactions");
      await blocker.query("COMMIT");
      const outcomes = await settleWithoutDeadlock([typedAnswer, replacement]);
      const typedOutcome = outcomes[0];
      const replacementOutcome = outcomes[1];
      if (typedOutcome?.status !== "fulfilled")
        throw new Error("The typed expense answer did not finish recoverably.");
      typedAnswerApplied = (typedOutcome.value as { status: string }).status === "applied";
      if (typedAnswerApplied) {
        expect(replacementOutcome).toEqual(
          expect.objectContaining({
            reason: expect.objectContaining({ code: "conflict" }),
            status: "rejected",
          }),
        );
      } else {
        expect(typedOutcome.value).toMatchObject({ status: "needs_input" });
        expect(replacementOutcome).toEqual(expect.objectContaining({ status: "fulfilled" }));
      }
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
      await contentionDatabase.close();
    }
    const allocations = await database.db
      .select({
        amount: financeTransactionAllocations.amount,
        id: financeTransactionAllocations.id,
        state: financeTransactionAllocations.state,
        treatment: financeTransactionAllocations.treatment,
      })
      .from(financeTransactionAllocations)
      .where(eq(financeTransactionAllocations.transactionId, expense.id));
    const cases = await database.db
      .select({
        allocationId: financeReimbursements.allocationId,
        expectedAmount: financeReimbursements.expectedAmount,
        receivedAmount: financeReimbursements.receivedAmount,
        status: financeReimbursements.status,
      })
      .from(financeReimbursements)
      .where(
        and(
          eq(financeReimbursements.userId, userId),
          inArray(
            financeReimbursements.allocationId,
            allocations.map((item) => item.id),
          ),
        ),
      );
    expect(
      allocations
        .filter((item) => item.state === "active")
        .reduce((sum, item) => sum + item.amount, 0),
    ).toBe(31_000);
    if (typedAnswerApplied) {
      expect(cases).toEqual([
        expect.objectContaining({ expectedAmount: 22_000, receivedAmount: 0, status: "expected" }),
      ]);
      expect(allocations.find((item) => item.id === allocation.id)).toEqual(
        expect.objectContaining({ state: "invalidated" }),
      );
      expect(allocations.filter((item) => item.state === "active")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ amount: 9_000, treatment: "personal" }),
          expect.objectContaining({ amount: 22_000, treatment: "reimbursable" }),
        ]),
      );
    } else {
      expect(cases).toEqual([]);
      expect(allocations).toEqual([
        expect.objectContaining({ amount: 31_000, state: "active", treatment: "personal" }),
      ]);
    }
    await expect(
      database.db
        .select({ status: financeAgentActionReviews.status })
        .from(financeAgentActionReviews)
        .where(eq(financeAgentActionReviews.id, question.id)),
    ).resolves.toEqual([{ status: "superseded" }]);
    await expect(
      database.db
        .select({ action: auditEvents.action })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.entityId, question.id),
            eq(auditEvents.action, "finance.question_answered"),
          ),
        ),
    ).resolves.toEqual([{ action: "finance.question_answered" }]);
  });

  it("serializes direct reimbursement creation before replacing its allocation breakdown", async () => {
    const [account] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "Topology",
        name: `create-breakdown-${crypto.randomUUID()}`,
        provider: "manual",
        status: "manual",
        userId,
      })
      .returning();
    const [category] = await database.db
      .insert(financeCategories)
      .values({
        group: "Topology",
        name: `create-breakdown-${crypto.randomUUID()}`,
        slug: `create-breakdown-${crypto.randomUUID()}`,
        userId,
      })
      .returning();
    if (!account || !category) throw new Error("Topology create/breakdown fixture failed.");
    const [expense] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: account.id,
        amount: 10_000,
        category: category.name,
        categoryId: category.id,
        direction: "expense",
        merchant: "Topology",
        transactionDate: "2026-08-17",
        userId,
      })
      .returning();
    if (!expense) throw new Error("Topology expense fixture failed.");
    const [allocation] = await database.db
      .insert(financeTransactionAllocations)
      .values({
        allocationOrder: 0,
        amount: 10_000,
        categoryId: category.id,
        transactionId: expense.id,
        treatment: "reimbursable",
        userId,
      })
      .returning();
    if (!allocation) throw new Error("Topology allocation fixture failed.");
    const finances = createFinanceService({ db: database.db, now: () => now });
    const blocker = await database.pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("SET LOCAL statement_timeout = '5s'");
      await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `finance-reimbursement-topology:${userId}`,
      ]);
      const created = finances.reconcileReimbursement(
        {
          allocationId: allocation.id,
          dueDate: null,
          evidence: { sourceRefs: [], summary: "Topology" },
          expectedAmount: 100,
          operation: "create",
          payer: "Alex",
          rationale: "Topology",
        },
        { principal: user(userId), requestId: "topology-create" },
      );
      const replaced = finances.setTransactionBreakdown(
        expense.id,
        {
          allocations: [{ amount: 100, categoryId: category.id, rationale: "Replacement" }],
          expectedTransactionUpdatedAt: expense.updatedAt.toISOString(),
          rationale: "Replacement",
        },
        { principal: user(userId), requestId: "topology-breakdown" },
      );
      await waitForAdvisoryLockWaiters(database.pool, 2);
      await blocker.query("COMMIT");
      const outcomes = await settleWithoutDeadlock([created, replaced]);
      expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(true);
      expect(
        outcomes.every(
          (outcome) =>
            outcome.status === "fulfilled" ||
            (outcome.reason as { code?: string }).code === "conflict" ||
            (outcome.reason as { code?: string }).code === "invalid_request",
        ),
      ).toBe(true);
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
    }
    const cases = await database.db
      .select({ allocationId: financeReimbursements.allocationId })
      .from(financeReimbursements)
      .where(eq(financeReimbursements.allocationId, allocation.id));
    expect(cases.length).toBeLessThanOrEqual(1);
  });

  it("serializes direct reimbursement creation before expense-account deletion", async () => {
    const [account] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "Topology",
        name: `create-delete-${crypto.randomUUID()}`,
        provider: "manual",
        status: "manual",
        userId,
      })
      .returning();
    const [category] = await database.db
      .insert(financeCategories)
      .values({
        group: "Topology",
        name: `create-delete-${crypto.randomUUID()}`,
        slug: `create-delete-${crypto.randomUUID()}`,
        userId,
      })
      .returning();
    if (!account || !category) throw new Error("Topology create/delete fixture failed.");
    const [expense] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: account.id,
        amount: 10_000,
        category: category.name,
        categoryId: category.id,
        direction: "expense",
        merchant: "Topology",
        transactionDate: "2026-08-17",
        userId,
      })
      .returning();
    if (!expense) throw new Error("Topology delete expense fixture failed.");
    const [allocation] = await database.db
      .insert(financeTransactionAllocations)
      .values({
        allocationOrder: 0,
        amount: 10_000,
        categoryId: category.id,
        transactionId: expense.id,
        treatment: "reimbursable",
        userId,
      })
      .returning();
    if (!allocation) throw new Error("Topology delete allocation fixture failed.");
    const finances = createFinanceService({ db: database.db, now: () => now });
    const blocker = await database.pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("SET LOCAL statement_timeout = '5s'");
      await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `finance-reimbursement-topology:${userId}`,
      ]);
      const created = finances.reconcileReimbursement(
        {
          allocationId: allocation.id,
          dueDate: null,
          evidence: { sourceRefs: [], summary: "Topology" },
          expectedAmount: 100,
          operation: "create",
          payer: "Alex",
          rationale: "Topology",
        },
        { principal: user(userId), requestId: "topology-create-delete" },
      );
      const deletion = finances.deleteAccount(account.id, {
        principal: user(userId),
        requestId: "topology-delete",
      });
      await waitForAdvisoryLockWaiters(database.pool, 2);
      await blocker.query("COMMIT");
      const outcomes = await settleWithoutDeadlock([created, deletion]);
      expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(true);
      expect(
        outcomes.every(
          (outcome) =>
            outcome.status === "fulfilled" ||
            (outcome.reason as { code?: string }).code === "conflict" ||
            (outcome.reason as { code?: string }).code === "invalid_request",
        ),
      ).toBe(true);
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
    }
    const accounts = await database.db
      .select({ id: financeAccounts.id })
      .from(financeAccounts)
      .where(eq(financeAccounts.id, account.id));
    const cases = await database.db
      .select({ allocationId: financeReimbursements.allocationId })
      .from(financeReimbursements)
      .where(eq(financeReimbursements.allocationId, allocation.id));
    expect(accounts.length === 1 || cases.length === 0).toBe(true);
  });

  it("accepts canonical provider-backed expense and credit evidence and rejects a stale provider revision", async () => {
    await database.db
      .update(financeAutomationSettings)
      .set({ reviewBypassEnabled: true, updatedAt: now })
      .where(eq(financeAutomationSettings.userId, userId));
    const [category] = await database.db
      .insert(financeCategories)
      .values({
        group: "Spending",
        name: `Provider evidence ${crypto.randomUUID()}`,
        slug: `provider-evidence-${crypto.randomUUID()}`,
        userId,
      })
      .returning();
    if (!category) throw new Error("Provider evidence category failed.");
    const service = createFinanceActionService({
      db: database.db,
      finances: createFinanceService({ db: database.db, now: () => now }),
      now: () => now,
    });
    for (const provider of ["plaid", "paypal", "venmo", "zelle"] as const) {
      const [account] = await database.db
        .insert(financeAccounts)
        .values({
          institution: `${provider} evidence`,
          name: `${provider} account`,
          provider,
          status: "connected",
          userId,
        })
        .returning();
      if (!account) throw new Error("Provider evidence account failed.");
      const [expense] = await database.db
        .insert(financeTransactions)
        .values({
          accountId: account.id,
          amount: 2_000,
          category: category.name,
          categoryId: category.id,
          direction: "expense",
          merchant: `${provider} expense`,
          providerTransactionId: `${provider}-expense-${crypto.randomUUID()}`,
          transactionDate: "2026-08-17",
          userId,
        })
        .returning();
      if (!expense?.providerTransactionId) throw new Error("Provider expense failed.");
      const [expenseAllocation] = await database.db
        .insert(financeTransactionAllocations)
        .values({
          allocationOrder: 0,
          amount: expense.amount,
          categoryId: category.id,
          transactionId: expense.id,
          treatment: "personal",
          userId,
        })
        .returning();
      if (!expenseAllocation) throw new Error("Provider expense allocation failed.");
      const expenseSource: MaterialSourceReference = {
        accountId: account.id,
        provider,
        remoteId: expense.providerTransactionId,
        revision: expense.updatedAt.toISOString(),
        sourceType: "finance_transaction",
      };
      const expenseQuestion = await storeReimbursementQuestion(database, {
        accountId: account.id,
        candidate: { allocationIds: [expenseAllocation.id], transactionId: expense.id },
        source: expenseSource,
        transaction: expense,
        userId,
      });
      await expect(
        service.answerQuestion(
          expenseQuestion.id,
          JSON.stringify({ answer: { kind: "entirely_personal", rationale: "Personal." } }),
          { principal: agent(userId, "maintenance-answerer"), requestId: `${provider}-expense` },
        ),
      ).resolves.toMatchObject({ status: "applied" });
      if (provider === "plaid") {
        const [currentExpense] = await database.db
          .select()
          .from(financeTransactions)
          .where(eq(financeTransactions.id, expense.id));
        if (!currentExpense) throw new Error("Provider stale fixture was not refreshed.");
        const staleQuestion = await storeReimbursementQuestion(database, {
          accountId: account.id,
          candidate: { allocationIds: [expenseAllocation.id], transactionId: currentExpense.id },
          source: {
            accountId: account.id,
            provider,
            remoteId: expense.providerTransactionId,
            revision: currentExpense.updatedAt.toISOString(),
            sourceType: "finance_transaction",
          },
          transaction: currentExpense,
          userId,
        });
        await database.db
          .update(financeTransactions)
          .set({ notes: "Provider revision changed", updatedAt: new Date("2026-08-18T12:00:00Z") })
          .where(eq(financeTransactions.id, currentExpense.id));
        await expect(
          service.answerQuestion(
            staleQuestion.id,
            JSON.stringify({ answer: { kind: "entirely_personal", rationale: "Personal." } }),
            { principal: agent(userId, "maintenance-answerer"), requestId: "plaid-stale" },
          ),
        ).resolves.toMatchObject({ question: { id: staleQuestion.id }, status: "needs_input" });
      }

      const [caseExpense] = await database.db
        .insert(financeTransactions)
        .values({
          accountId: account.id,
          amount: 2_000,
          category: category.name,
          categoryId: category.id,
          direction: "expense",
          merchant: `${provider} shared expense`,
          providerTransactionId: `${provider}-case-${crypto.randomUUID()}`,
          transactionDate: "2026-08-17",
          userId,
        })
        .returning();
      if (!caseExpense?.providerTransactionId)
        throw new Error("Provider reimbursement expense failed.");
      const [caseAllocation] = await database.db
        .insert(financeTransactionAllocations)
        .values({
          allocationOrder: 0,
          amount: caseExpense.amount,
          categoryId: category.id,
          transactionId: caseExpense.id,
          treatment: "reimbursable",
          userId,
        })
        .returning();
      if (!caseAllocation) throw new Error("Provider reimbursement allocation failed.");
      const [reimbursement] = await database.db
        .insert(financeReimbursements)
        .values({
          allocationId: caseAllocation.id,
          evidence: {
            sourceRefs: [
              {
                accountId: account.id,
                provider,
                remoteId: caseExpense.providerTransactionId,
                revision: caseExpense.updatedAt.toISOString(),
                sourceType: "finance_transaction",
              },
            ],
            summary: "Provider receipt",
          },
          expectedAmount: 2_000,
          payer: "Alex",
          rationale: "Shared expense.",
          userId,
        })
        .returning();
      const [credit] = await database.db
        .insert(financeTransactions)
        .values({
          accountId: account.id,
          amount: 1_000,
          direction: "income",
          merchant: `${provider} repayment`,
          providerTransactionId: `${provider}-credit-${crypto.randomUUID()}`,
          transactionDate: "2026-08-18",
          userId,
        })
        .returning();
      if (!reimbursement || !credit?.providerTransactionId)
        throw new Error("Provider credit fixture failed.");
      const creditQuestion = await storeReimbursementQuestion(database, {
        accountId: account.id,
        candidate: { reimbursementIds: [reimbursement.id], transactionId: credit.id },
        source: {
          accountId: account.id,
          provider,
          remoteId: credit.providerTransactionId,
          revision: credit.updatedAt.toISOString(),
          sourceType: "finance_transaction",
        },
        transaction: credit,
        userId,
      });
      await expect(
        service.answerQuestion(
          creditQuestion.id,
          JSON.stringify({
            answer: { kind: "match", matches: [{ amount: 10, reimbursementId: reimbursement.id }] },
          }),
          { principal: agent(userId, "maintenance-answerer"), requestId: `${provider}-credit` },
        ),
      ).resolves.toMatchObject({ status: "applied" });
    }
  });
});
