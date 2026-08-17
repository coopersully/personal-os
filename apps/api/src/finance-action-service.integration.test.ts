import { resolve } from "node:path";
import {
  createDatabaseClient,
  financeAccounts,
  financeAgentActionReviews,
  financeAlerts,
  financeAutomationSettings,
  financeCategories,
  financeClassificationDecisions,
  financeIncomeStreams,
  financeMerchants,
  financeProfiles,
  financeRecurringObligations,
  financeTransactions,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import type { SupportedActionKind } from "./finance-action-service.js";
import { createFinanceActionService } from "./finance-action-service.js";
import { createFinanceService } from "./finance-service.js";
import type { Principal } from "./types.js";

const now = new Date("2026-08-17T12:00:00.000Z");

function agent(userId: string): Principal {
  return {
    actorId: "finance-agent",
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
      actionKind: "income_stream",
      foreignInput: { id: income.id, status: "paused" },
      input: { id: income.id, status: "paused" },
      missingInput: {},
    },
  ];
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

    await expect(
      service.performDirect("categorization", decision(0.5), context),
    ).resolves.toMatchObject({ status: "needs_input" });
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
    await expect(
      service.performDirect("categorization", decision(0.5), context),
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
    await expect(
      service.answerQuestion(stored.id, "not JSON", {
        principal: agent(userId),
        requestId: "answer-question-malformed",
      }),
    ).resolves.toMatchObject({
      question: { expectedAnswer: [{ name: "payAccountId", type: "string" }], id: stored.id },
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
      service.answerQuestion(stored.id, JSON.stringify({ payAccountId: account.id }), {
        principal: agent(userId),
        requestId: "answer-question",
      }),
    ).resolves.toMatchObject({ result: { id: "answered-profile" }, status: "applied" });
    await expect(
      database.db
        .select({ status: financeAgentActionReviews.status })
        .from(financeAgentActionReviews)
        .where(eq(financeAgentActionReviews.id, stored.id)),
    ).resolves.toEqual([{ status: "superseded" }]);
    expect(updateProfile).toHaveBeenCalledOnce();
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
    const [transaction] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: account!.id,
        amount: 100,
        direction: "expense",
        merchant: "Overlap",
        transactionDate: "2026-09-05",
        userId,
      })
      .returning();
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
          categoryId: category!.id,
          confidence: 1,
          expectedTransactionUpdatedAt: transaction!.updatedAt.toISOString(),
          learnMerchant: "suggest",
          rationale,
          transactionId: transaction!.id,
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
});
