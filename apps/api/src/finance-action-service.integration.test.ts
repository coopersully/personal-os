import { resolve } from "node:path";
import {
  createDatabaseClient,
  financeAccounts,
  financeAgentActionReviews,
  financeAutomationSettings,
  financeProfiles,
  financeTransactions,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
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
});
