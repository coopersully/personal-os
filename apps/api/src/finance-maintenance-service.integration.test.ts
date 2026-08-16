import { resolve } from "node:path";
import {
  auditEvents,
  createDatabaseClient,
  type DatabaseClient,
  financeCategoryRules,
  financeReviewCases,
  financeTransactions,
  migrateDatabase,
  users,
  workspaceMaintenanceRuns,
  workspaceMaintenanceSteps,
} from "@personal-os/database";
import type {
  FinanceCategorizationProposal,
  FinanceStatus,
  MaintenanceScope,
} from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq, inArray, sql } from "drizzle-orm";
import { AppError } from "./errors.js";
import {
  createFinanceMaintenanceService,
  type FinanceMaintenanceOperations,
} from "./finance-maintenance-service.js";
import { createFinanceService } from "./finance-service.js";
import { createFinanceStatusService } from "./finance-status-service.js";
import { createWorkspaceMaintenanceService } from "./workspace-maintenance-service.js";

const now = new Date("2026-08-15T12:00:00.000Z");
const categoryId = "22222222-2222-4222-8222-222222222222";

function proposal(
  id: string,
  options: { confidence: number; pending?: boolean; possibleTransfer?: boolean },
): FinanceCategorizationProposal {
  return {
    confidence: options.confidence,
    meetsPolicyThreshold: options.confidence >= 0.95,
    policy: "preview",
    rationale: "Fixture evidence.",
    suggestionBasis: options.confidence > 0 ? "transaction_evidence" : null,
    source: {
      accountId: "33333333-3333-4333-8333-333333333333",
      provider: "local",
      remoteId: id,
      revision: now.toISOString(),
      sourceType: "finance_transaction",
    },
    suggestedCategory:
      options.confidence > 0
        ? {
            color: null,
            group: "Spending",
            id: categoryId,
            isSystem: true,
            name: "Groceries",
            slug: "groceries",
          }
        : null,
    threshold: 0.95,
    transaction: {
      accountId: "33333333-3333-4333-8333-333333333333",
      amount: 12,
      category: null,
      categoryConfidence: null,
      categoryId: null,
      categoryRationale: null,
      categorySource: null,
      createdAt: now.toISOString(),
      currencyCode: null,
      date: "2026-08-14",
      direction: "expense",
      id,
      merchant: `Merchant ${id}`,
      merchantId: null,
      needsReview: true,
      notes: null,
      pending: options.pending ?? false,
      providerCategory: null,
      providerCategoryConfidence: null,
      providerDirection: null,
      rawMerchant: `Merchant ${id}`,
      reconciliationStatus: options.possibleTransfer ? "candidate" : "not_applicable",
      updatedAt: now.toISOString(),
    },
  };
}

describe.sequential("Finance maintenance service", () => {
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
        displayName: "Finance maintenance",
        email: "finance-maintenance@example.com",
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!user) throw new Error("Fixture user was not created.");
    userId = user.id;
  }, 120_000);

  afterAll(async () => {
    await database.close();
    await container.stop();
  });

  async function createUser(label: string) {
    const [user] = await database.db
      .insert(users)
      .values({
        displayName: label,
        email: `${label.toLowerCase().replaceAll(" ", "-")}-${crypto.randomUUID()}@example.com`,
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!user) throw new Error("Fixture user was not created.");
    return user.id;
  }

  function status(
    rulebookVersion = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    options: { blocked?: boolean; nonCurrent?: boolean; questions?: number } = {},
  ) {
    return {
      asOf: now.toISOString(),
      details: {
        health: { confidence: options.blocked ? "insufficient" : "reliable" },
        questions: [],
        review: { total: options.questions ?? 0 },
        rulebookVersion,
      },
      freshness: {
        blockers: options.blocked
          ? [{ code: "sync_blocked", message: "Finance source is blocked.", recovery: "operator" }]
          : [],
        state: options.blocked ? "unavailable" : options.nonCurrent ? "stale" : "current",
      },
      state: options.blocked ? "blocked" : "needs_work",
    } as unknown as FinanceStatus;
  }

  function operations(
    overrides: Partial<FinanceMaintenanceOperations> = {},
  ): FinanceMaintenanceOperations {
    return {
      applyApprovedRules: async () => [],
      applyApprovedOneOffs: async () => [],
      proposeOutstandingCategorizations: async () => ({ items: [], nextCursor: null }),
      reconcileTransfersForUser: async () => ({ paired: 0, transfers: 0 }),
      refreshCashflowForUser: async () => ({ refreshed: true }),
      refreshMaintenanceQuestionsForUser: async () => ({ created: 0, total: 0 }),
      syncDueAccountsForUser: async () => ({
        attempted: 0,
        failed: 0,
        recovered: 0,
        skipped: 0,
        succeeded: 0,
      }),
      ...overrides,
    };
  }

  it("settles no-argument maintenance with bounded authorized work and replays without duplicate effects", async () => {
    const workspace = createWorkspaceMaintenanceService({ db: database.db, now: () => now });
    const applied = new Set<string>();
    let questionEffects = 0;
    const allProposals = [
      proposal("11111111-1111-4111-8111-111111111111", { confidence: 1 }),
      proposal("44444444-4444-4444-8444-444444444444", { confidence: 0.97 }),
      proposal("55555555-5555-4555-8555-555555555555", { confidence: 0 }),
      proposal("66666666-6666-4666-8666-666666666666", { confidence: 1, pending: true }),
    ];
    const status = {
      details: {
        health: { confidence: "reliable" },
        questions: [],
        review: { total: 2 },
        rulebookVersion: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      freshness: { blockers: [], state: "current" },
      state: "needs_work",
    } as unknown as FinanceStatus;
    const service = createFinanceMaintenanceService({
      finances: {
        applyApprovedRules: async () => [],
        applyApprovedOneOffs: async (input) => {
          const results = input.decisions.map((decision) => {
            const replayed = applied.has(decision.transactionId);
            applied.add(decision.transactionId);
            return {
              applied: !replayed,
              error: null,
              replayed,
              status: "applied" as const,
              threshold: 0.95,
              transaction: null,
              transactionId: decision.transactionId,
            };
          });
          return results;
        },
        proposeOutstandingCategorizations: async () => ({
          items: allProposals.filter((item) => !applied.has(item.transaction.id)),
          nextCursor: null,
        }),
        reconcileTransfersForUser: async () => ({
          paired: applied.size === 0 ? 1 : 0,
          transfers: applied.size === 0 ? 2 : 0,
        }),
        refreshCashflowForUser: async () => ({ refreshed: true }),
        refreshMaintenanceQuestionsForUser: async () => {
          const created = questionEffects === 0 ? 2 : 0;
          questionEffects += created;
          return { created, total: 2 };
        },
        syncDueAccountsForUser: async () => ({
          attempted: 1,
          failed: 0,
          recovered: 0,
          skipped: 0,
          succeeded: 1,
        }),
      },
      maintenance: workspace,
      now: () => now,
      status: { getFinanceStatus: async () => status },
    });

    const run = await service.startOrResume(userId, { type: "all_outstanding" });
    await service.dispatchDue(1);
    const settled = await service.getRun(userId, run.id);
    expect(settled.status).toBe("completed_with_questions");
    expect(settled.settledResult).toMatchObject({
      applied: { categorizations: 2, transfers: 2 },
      questions: { total: 2 },
      verification: { duplicateActions: 0 },
    });

    const replay = await service.startOrResume(userId, { type: "all_outstanding" });
    await service.dispatchRun(replay.id);
    const replayed = await service.getRun(userId, replay.id);
    expect(replayed.settledResult).toMatchObject({
      applied: { categorizations: 0, transfers: 0 },
      questions: { created: 0, total: 2 },
      verification: { duplicateActions: 0 },
    });
    expect(applied).toHaveLength(2);
    expect(questionEffects).toBe(2);
  });

  it("maintains a real Finance ledger and repeats with no duplicate mutations, questions, or audits", async () => {
    const ownerId = await createUser("Real Finance maintenance");
    const finances = createFinanceService({ db: database.db, now: () => now });
    const context = {
      principal: {
        actorId: ownerId,
        actorType: "user" as const,
        scopes: new Set(["finances:read" as const, "finances:write" as const]),
        userId: ownerId,
      },
      requestId: "real-finance-maintenance-fixture",
    };
    const checking = await finances.createAccount(
      { balance: 2_000, institution: "Bank", kind: "cash", name: "Checking", provider: "manual" },
      context,
    );
    const card = await finances.createAccount(
      { balance: -500, institution: "Card", kind: "debt", name: "Card", provider: "manual" },
      context,
    );
    const groceries = (await finances.listCategories(ownerId)).find(
      (category) => category.name === "Groceries",
    );
    if (!groceries) throw new Error("Groceries category was not seeded.");

    const exactRuleCandidate = await finances.createTransaction(
      {
        accountId: checking.id,
        amount: 20,
        category: null,
        categoryConfidence: null,
        date: "2026-08-10",
        direction: "expense",
        merchant: "Exact Unusual",
        notes: null,
      },
      context,
    );
    await database.db.insert(financeCategoryRules).values({
      category: "Groceries",
      merchantNormalized: "exact unusual",
      userId: ownerId,
    });
    for (const amount of [11, 12]) {
      const evidence = await finances.createTransaction(
        {
          accountId: checking.id,
          amount,
          category: null,
          categoryConfidence: null,
          date: "2026-08-11",
          direction: "expense",
          merchant: "One Off Merchant",
          notes: null,
        },
        context,
      );
      await finances.updateTransaction(
        evidence.id,
        { category: "Groceries", learnMerchant: false },
        context,
      );
    }
    const oneOffCandidate = await finances.createTransaction(
      {
        accountId: checking.id,
        amount: 13,
        category: null,
        categoryConfidence: null,
        date: "2026-08-12",
        direction: "expense",
        merchant: "One Off Merchant",
        notes: null,
      },
      context,
    );
    await finances.createTransaction(
      {
        accountId: checking.id,
        amount: 14,
        category: null,
        categoryConfidence: null,
        date: "2026-08-13",
        direction: "expense",
        merchant: "Opaque Merchant",
        notes: null,
      },
      context,
    );
    const pending = await finances.createTransaction(
      {
        accountId: checking.id,
        amount: 15,
        category: null,
        categoryConfidence: null,
        date: "2026-08-14",
        direction: "expense",
        merchant: "Whole Foods",
        notes: null,
      },
      context,
    );
    await database.db
      .update(financeTransactions)
      .set({
        category: null,
        categoryConfidence: null,
        categoryId: null,
        categorySource: null,
        needsReview: true,
        pending: true,
      })
      .where(eq(financeTransactions.id, pending.id));
    const transferOut = await finances.createTransaction(
      {
        accountId: checking.id,
        amount: 100,
        category: "LOAN_PAYMENTS",
        categoryConfidence: null,
        date: "2026-08-14",
        direction: "expense",
        merchant: "CARD PAYMENT",
        notes: null,
      },
      context,
    );
    const transferIn = await finances.createTransaction(
      {
        accountId: card.id,
        amount: 100,
        category: "LOAN_PAYMENTS",
        categoryConfidence: null,
        date: "2026-08-15",
        direction: "income",
        merchant: "CARD PAYMENT",
        notes: null,
      },
      context,
    );
    await database.db
      .update(financeTransactions)
      .set({ categoryDecidedAt: null, categorySource: "provider" })
      .where(eq(financeTransactions.userId, ownerId));
    await database.db
      .update(financeTransactions)
      .set({ currencyCode: "USD" })
      .where(inArray(financeTransactions.id, [transferOut.id, transferIn.id]));
    for (const id of [1, 2]) {
      await finances.createTransaction(
        {
          accountId: checking.id,
          amount: 33,
          category: null,
          categoryConfidence: null,
          date: "2026-08-15",
          direction: "expense",
          merchant: "Duplicate Candidate",
          notes: `source ${id}`,
        },
        context,
      );
    }

    const maintenance = createWorkspaceMaintenanceService({ db: database.db, now: () => now });
    const financeStatus = createFinanceStatusService({
      assistant: {} as never,
      db: database.db,
      finances,
      goals: {} as never,
      maintenance,
      now: () => now,
    });
    const service = createFinanceMaintenanceService({
      finances,
      maintenance,
      now: () => now,
      status: financeStatus,
    });

    const run = await service.startOrResume(ownerId, { type: "all_outstanding" });
    await service.dispatchRun(run.id);
    await expect(service.getRun(ownerId, run.id)).resolves.toMatchObject({
      settledResult: {
        applied: { categorizations: 2, transfers: 2 },
        questions: { total: 2 },
        verification: { duplicateActions: 0 },
      },
      status: "completed_with_questions",
    });
    await expect(finances.summarizeMaintenanceEffectsForRun(ownerId, run.id)).resolves.toEqual({
      categorizations: 2,
      duplicateActions: 0,
      transfers: 2,
    });
    const appliedRows = await database.db
      .select({
        category: financeTransactions.category,
        categorySource: financeTransactions.categorySource,
        id: financeTransactions.id,
      })
      .from(financeTransactions)
      .where(eq(financeTransactions.userId, ownerId));
    expect(appliedRows.find((row) => row.id === exactRuleCandidate.id)).toMatchObject({
      category: "Groceries",
      categorySource: "rule",
    });
    expect(appliedRows.find((row) => row.id === oneOffCandidate.id)).toMatchObject({
      category: "Groceries",
      categorySource: "agent",
    });
    expect(appliedRows.filter((row) => [transferOut.id, transferIn.id].includes(row.id))).toEqual([
      expect.objectContaining({ category: "Transfers" }),
      expect.objectContaining({ category: "Transfers" }),
    ]);
    const questionsAfterFirst = await database.db
      .select({ id: financeReviewCases.id, reason: financeReviewCases.reason })
      .from(financeReviewCases)
      .where(eq(financeReviewCases.userId, ownerId));
    expect(questionsAfterFirst.map((question) => question.reason).sort()).toEqual([
      "possible_duplicate",
      "unknown_merchant",
    ]);
    const auditsAfterFirst = await database.db
      .select({
        action: auditEvents.action,
        after: auditEvents.after,
        id: auditEvents.id,
        requestId: auditEvents.requestId,
      })
      .from(auditEvents)
      .where(eq(auditEvents.userId, ownerId));
    const maintenanceAudits = auditsAfterFirst.filter((audit) =>
      audit.requestId.startsWith(`maintenance:${run.id}:`),
    );
    expect(maintenanceAudits.map((audit) => audit.action)).toEqual(
      expect.arrayContaining([
        "finance.review_queued",
        "finance.transaction_categorized",
        "finance.transfer_reconciled",
      ]),
    );
    expect(maintenanceAudits).not.toHaveLength(0);
    for (const audit of maintenanceAudits) {
      expect(audit.after).toMatchObject({
        maintenance: {
          idempotencyKey: expect.stringContaining(run.rulebookVersion),
          policy: "approved_rule",
          rulebookVersion: run.rulebookVersion,
          runId: run.id,
        },
        source: {
          accountId: expect.any(String),
          revision: expect.any(String),
          sourceType: "finance_transaction",
        },
      });
    }

    const replay = await service.startOrResume(ownerId, { type: "all_outstanding" });
    await service.dispatchRun(replay.id);
    await expect(service.getRun(ownerId, replay.id)).resolves.toMatchObject({
      settledResult: {
        applied: { categorizations: 0, transfers: 0 },
        questions: { created: 0, total: 2 },
        verification: { duplicateActions: 0 },
      },
      status: "completed_with_questions",
    });
    await expect(service.dispatchDue(0)).resolves.toMatchObject({ attempted: 0 });
    await expect(service.dispatchDue(100)).resolves.toMatchObject({ attempted: 0 });
    await expect(
      database.db
        .select({ id: financeReviewCases.id, reason: financeReviewCases.reason })
        .from(financeReviewCases)
        .where(eq(financeReviewCases.userId, ownerId)),
    ).resolves.toEqual(questionsAfterFirst);
    await expect(
      database.db
        .select({
          action: auditEvents.action,
          after: auditEvents.after,
          id: auditEvents.id,
          requestId: auditEvents.requestId,
        })
        .from(auditEvents)
        .where(eq(auditEvents.userId, ownerId)),
    ).resolves.toEqual(auditsAfterFirst);
  });

  it("routes an exact merchant rule through only the rule-attributed writer", async () => {
    const ownerId = await createUser("Finance rule-only maintenance");
    let ruleWrites = 0;
    let oneOffWrites = 0;
    const exactRuleProposal = {
      ...proposal(crypto.randomUUID(), { confidence: 1 }),
      suggestionBasis: "merchant_rule" as const,
    };
    const service = createFinanceMaintenanceService({
      finances: operations({
        applyApprovedRules: async (input) => {
          ruleWrites += input.decisions.length;
          return input.decisions.map((decision) => ({
            applied: true,
            error: null,
            replayed: false,
            status: "applied" as const,
            threshold: 0.95,
            transaction: null,
            transactionId: decision.transactionId,
          }));
        },
        applyApprovedOneOffs: async () => {
          oneOffWrites += 1;
          return [];
        },
        proposeOutstandingCategorizations: async () => ({
          items: [exactRuleProposal],
          nextCursor: null,
        }),
      }),
      maintenance: createWorkspaceMaintenanceService({ db: database.db, now: () => now }),
      now: () => now,
      status: { getFinanceStatus: async () => status() },
    });
    const run = await service.startOrResume(ownerId, { type: "all_outstanding" });

    await service.dispatchRun(run.id);

    expect(ruleWrites).toBe(1);
    expect(oneOffWrites).toBe(0);
  });

  it("persists a 50-item categorization cursor and resumes it on another runtime", async () => {
    const ownerId = await createUser("Finance continuation");
    const workspaceOne = createWorkspaceMaintenanceService({ db: database.db, now: () => now });
    const workspaceTwo = createWorkspaceMaintenanceService({ db: database.db, now: () => now });
    const proposals = Array.from({ length: 51 }, () =>
      proposal(crypto.randomUUID(), { confidence: 1 }),
    );
    const batchSizes: number[] = [];
    const financeOperations = operations({
      applyApprovedOneOffs: async (input) => {
        batchSizes.push(input.decisions.length);
        return input.decisions.map((decision) => ({
          applied: true,
          error: null,
          replayed: false,
          status: "applied" as const,
          threshold: 0.95,
          transaction: null,
          transactionId: decision.transactionId,
        }));
      },
      proposeOutstandingCategorizations: async (_userId, _scope, cursor) =>
        cursor
          ? { items: proposals.slice(50), nextCursor: null }
          : { items: proposals.slice(0, 50), nextCursor: "page-2" },
    });
    const firstRuntime = createFinanceMaintenanceService({
      finances: financeOperations,
      maintenance: workspaceOne,
      now: () => now,
      status: { getFinanceStatus: async () => status() },
    });
    const run = await firstRuntime.startOrResume(ownerId, { type: "all_outstanding" });

    await firstRuntime.dispatchRun(run.id);
    await expect(firstRuntime.getRun(ownerId, run.id)).resolves.toMatchObject({
      checkpoint: { applied: 50, cursor: "page-2", step: "categorize" },
      status: "queued",
    });

    const recoveredRuntime = createFinanceMaintenanceService({
      finances: financeOperations,
      maintenance: workspaceTwo,
      now: () => now,
      status: { getFinanceStatus: async () => status() },
    });
    await recoveredRuntime.dispatchRun(run.id);
    await expect(recoveredRuntime.getRun(ownerId, run.id)).resolves.toMatchObject({
      settledResult: { applied: { categorizations: 51 } },
      status: "completed",
    });
    expect(batchSizes).toEqual([50, 1]);
  });

  it("settles a verify-complete run after process loss instead of stranding it running", async () => {
    const ownerId = await createUser("Finance verify recovery");
    const workspace = createWorkspaceMaintenanceService({ db: database.db, now: () => now });
    let crashBeforeSettlement = true;
    const crashingMaintenance = {
      ...workspace,
      async settle(input: Parameters<typeof workspace.settle>[0]) {
        if (crashBeforeSettlement) {
          crashBeforeSettlement = false;
          throw new Error("process exited after verify committed");
        }
        return workspace.settle(input);
      },
    };
    const firstRuntime = createFinanceMaintenanceService({
      finances: operations(),
      maintenance: crashingMaintenance,
      now: () => now,
      status: { getFinanceStatus: async () => status() },
    });
    const run = await firstRuntime.startOrResume(ownerId, { type: "all_outstanding" });

    await expect(firstRuntime.dispatchRun(run.id)).rejects.toThrow();
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({ leaseExpiresAt: sql`NOW() - INTERVAL '1 second'` })
      .where(eq(workspaceMaintenanceRuns.id, run.id));
    await database.db
      .delete(workspaceMaintenanceSteps)
      .where(
        and(
          eq(workspaceMaintenanceSteps.runId, run.id),
          eq(workspaceMaintenanceSteps.stepName, "questions"),
        ),
      );
    for (const stepName of ["categorize", "reconcile"]) {
      await database.db
        .delete(workspaceMaintenanceSteps)
        .where(
          and(
            eq(workspaceMaintenanceSteps.runId, run.id),
            eq(workspaceMaintenanceSteps.stepName, stepName),
          ),
        );
    }

    const recoveredRuntime = createFinanceMaintenanceService({
      finances: operations(),
      maintenance: workspace,
      now: () => now,
      status: { getFinanceStatus: async () => status(undefined, { questions: 1 }) },
    });
    await recoveredRuntime.dispatchRun(run.id);
    await expect(recoveredRuntime.getRun(ownerId, run.id)).resolves.toMatchObject({
      status: "completed_with_questions",
    });

    const blockedOwnerId = await createUser("Finance blocked verify recovery");
    const blockedWorkspace = createWorkspaceMaintenanceService({ db: database.db, now: () => now });
    let blockedCrashBeforeSettlement = true;
    let sourceBlocked = false;
    const blockedCrashingMaintenance = {
      ...blockedWorkspace,
      async settle(input: Parameters<typeof blockedWorkspace.settle>[0]) {
        if (blockedCrashBeforeSettlement) {
          blockedCrashBeforeSettlement = false;
          sourceBlocked = true;
          throw new Error("process exited before blocked settlement");
        }
        return blockedWorkspace.settle(input);
      },
    };
    const blockedStatus = async () => ({
      ...status(),
      state: sourceBlocked ? ("blocked" as const) : ("needs_work" as const),
    });
    const blockedFirstRuntime = createFinanceMaintenanceService({
      finances: operations(),
      maintenance: blockedCrashingMaintenance,
      now: () => now,
      status: { getFinanceStatus: blockedStatus },
    });
    const blockedRun = await blockedFirstRuntime.startOrResume(blockedOwnerId, {
      type: "all_outstanding",
    });

    await expect(blockedFirstRuntime.dispatchRun(blockedRun.id)).rejects.toThrow();
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({ leaseExpiresAt: sql`NOW() - INTERVAL '1 second'` })
      .where(eq(workspaceMaintenanceRuns.id, blockedRun.id));

    const blockedRecoveredRuntime = createFinanceMaintenanceService({
      finances: operations(),
      maintenance: blockedWorkspace,
      now: () => now,
      status: { getFinanceStatus: blockedStatus },
    });
    await blockedRecoveredRuntime.dispatchRun(blockedRun.id);
    await expect(
      blockedRecoveredRuntime.getRun(blockedOwnerId, blockedRun.id),
    ).resolves.toMatchObject({ status: "blocked" });
  });

  it("revalidates rulebook and source freshness before settling a recovered verify", async () => {
    async function crashAfterVerify(ownerId: string) {
      const workspace = createWorkspaceMaintenanceService({ db: database.db, now: () => now });
      let crash = true;
      const firstRuntime = createFinanceMaintenanceService({
        finances: operations(),
        maintenance: {
          ...workspace,
          async settle(input: Parameters<typeof workspace.settle>[0]) {
            if (crash) {
              crash = false;
              throw new Error("process exited after verify committed");
            }
            return workspace.settle(input);
          },
        },
        now: () => now,
        status: { getFinanceStatus: async () => status() },
      });
      const run = await firstRuntime.startOrResume(ownerId, { type: "all_outstanding" });
      await expect(firstRuntime.dispatchRun(run.id)).rejects.toThrow();
      await database.db
        .update(workspaceMaintenanceRuns)
        .set({ leaseExpiresAt: sql`NOW() - INTERVAL '1 second'` })
        .where(eq(workspaceMaintenanceRuns.id, run.id));
      return { run, workspace };
    }

    const rulebookOwner = await createUser("Finance recovered verify rulebook");
    const changedRulebook =
      "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
    const rulebookCrash = await crashAfterVerify(rulebookOwner);
    const changedRuntime = createFinanceMaintenanceService({
      finances: operations(),
      maintenance: rulebookCrash.workspace,
      now: () => now,
      status: { getFinanceStatus: async () => status(changedRulebook) },
    });
    await changedRuntime.dispatchRun(rulebookCrash.run.id);
    await expect(changedRuntime.getRun(rulebookOwner, rulebookCrash.run.id)).resolves.toMatchObject(
      {
        settledResult: { code: "finance_rulebook_changed" },
        status: "failed_terminal",
      },
    );
    await expect(
      changedRuntime.startOrResume(rulebookOwner, { type: "all_outstanding" }),
    ).resolves.toMatchObject({ rulebookVersion: changedRulebook, status: "queued" });

    const staleOwner = await createUser("Finance recovered verify stale source");
    const staleCrash = await crashAfterVerify(staleOwner);
    const staleRuntime = createFinanceMaintenanceService({
      finances: operations(),
      maintenance: staleCrash.workspace,
      now: () => now,
      status: {
        getFinanceStatus: async () => {
          const current = status();
          return {
            ...current,
            freshness: { ...current.freshness, blockers: [], state: "stale" as const },
          };
        },
      },
    });
    await staleRuntime.dispatchRun(staleCrash.run.id);
    await expect(staleRuntime.getRun(staleOwner, staleCrash.run.id)).resolves.toMatchObject({
      lastSafeError: { code: "finance_source_not_current" },
      status: "failed_recoverable",
    });
    await expect(staleCrash.workspace.listStepRecords(staleCrash.run.id)).resolves.not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "failed_recoverable", step: "verify" }),
      ]),
    );
  });

  it("recovers a committed categorization after process loss before its checkpoint", async () => {
    const ownerId = await createUser("Finance process loss");
    const workspace = createWorkspaceMaintenanceService({ db: database.db, now: () => now });
    const candidate = proposal("99999999-9999-4999-8999-999999999999", { confidence: 1 });
    let committed = false;
    let loseProcess = true;
    const financeOperations = operations({
      applyApprovedOneOffs: async (input, context) => {
        if (!committed) {
          committed = true;
          await database.db.insert(auditEvents).values({
            action: "finance.transaction_categorized",
            actorId: context.principal.actorId,
            actorType: context.principal.actorType,
            after: { categoryId },
            before: { categoryId: null },
            entityId: input.decisions[0]?.transactionId ?? candidate.transaction.id,
            entityType: "finance_transaction",
            requestId: context.requestId,
            userId: ownerId,
          });
        }
        if (loseProcess) {
          loseProcess = false;
          throw new Error("process exited after commit");
        }
        return [];
      },
      proposeOutstandingCategorizations: async () => ({
        items: committed ? [] : [candidate],
        nextCursor: null,
      }),
      summarizeMaintenanceEffectsForRun: async (userId, _runId) => {
        const rows = await database.db
          .select({ action: auditEvents.action, entityId: auditEvents.entityId })
          .from(auditEvents)
          .where(eq(auditEvents.userId, userId));
        const matching = rows.filter(
          (row) =>
            row.action === "finance.transaction_categorized" &&
            row.entityId === candidate.transaction.id,
        );
        return {
          categorizations: matching.length,
          duplicateActions: matching.length - new Set(matching.map((row) => row.entityId)).size,
          transfers: 0,
        };
      },
    });
    const firstRuntime = createFinanceMaintenanceService({
      finances: financeOperations,
      maintenance: workspace,
      now: () => now,
      status: { getFinanceStatus: async () => status() },
    });
    const run = await firstRuntime.startOrResume(ownerId, { type: "all_outstanding" });
    await firstRuntime.dispatchRun(run.id);
    await expect(firstRuntime.getRun(ownerId, run.id)).resolves.toMatchObject({
      status: "failed_recoverable",
    });
    await database.pool.query(
      `UPDATE workspace_maintenance_runs SET retry_at = NOW() - INTERVAL '1 second' WHERE id = $1`,
      [run.id],
    );

    const recoveredRuntime = createFinanceMaintenanceService({
      finances: financeOperations,
      maintenance: createWorkspaceMaintenanceService({ db: database.db, now: () => now }),
      now: () => now,
      status: { getFinanceStatus: async () => status() },
    });
    await recoveredRuntime.dispatchRun(run.id);
    await expect(recoveredRuntime.getRun(ownerId, run.id)).resolves.toMatchObject({
      settledResult: {
        applied: { categorizations: 1 },
        verification: { duplicateActions: 0 },
      },
      status: "completed",
    });
  });

  it("settles explicit source blockers durably blocked without preserving a false checkpoint", async () => {
    const ownerId = await createUser("Finance blocked sync");
    const workspace = createWorkspaceMaintenanceService({ db: database.db, now: () => now });
    let sourceBlocked = false;
    const service = createFinanceMaintenanceService({
      finances: operations({
        syncDueAccountsForUser: async () => {
          sourceBlocked = true;
          return {
            attempted: 1,
            failed: 1,
            recovered: 0,
            skipped: 0,
            succeeded: 0,
          };
        },
      }),
      maintenance: workspace,
      now: () => now,
      status: {
        getFinanceStatus: async () => status(undefined, { blocked: sourceBlocked }),
      },
    });
    const run = await service.startOrResume(ownerId, { type: "all_outstanding" });
    await service.dispatchRun(run.id);

    await expect(service.getRun(ownerId, run.id)).resolves.toMatchObject({
      retryAt: null,
      status: "blocked",
    });
    await expect(workspace.listStepRecords(run.id)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "completed", step: "preflight" })]),
    );
    await expect(workspace.listStepRecords(run.id)).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ step: "synchronize" })]),
    );

    sourceBlocked = false;
    const recovered = await service.startOrResume(ownerId, { type: "all_outstanding" });
    expect(recovered).toMatchObject({ id: run.id, status: "queued" });
  });

  it("blocks on a changed operative rulebook before the next mutation", async () => {
    const ownerId = await createUser("Finance rulebook conflict");
    const workspace = createWorkspaceMaintenanceService({ db: database.db, now: () => now });
    let statusReads = 0;
    const changedRulebook =
      "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const service = createFinanceMaintenanceService({
      finances: operations(),
      maintenance: workspace,
      now: () => now,
      status: {
        getFinanceStatus: async () => {
          statusReads += 1;
          return status(statusReads === 1 ? undefined : changedRulebook);
        },
      },
    });
    const run = await service.startOrResume(ownerId, { type: "all_outstanding" });
    await service.dispatchRun(run.id);

    await expect(service.getRun(ownerId, run.id)).resolves.toMatchObject({
      settledResult: { code: "finance_rulebook_changed" },
      status: "failed_terminal",
    });
    await expect(workspace.listStepRecords(run.id)).resolves.toEqual([]);
    const replacement = await service.startOrResume(ownerId, { type: "all_outstanding" });
    expect(replacement).toMatchObject({ rulebookVersion: changedRulebook, status: "queued" });
    expect(replacement.id).not.toBe(run.id);
  });

  it("rechecks the rulebook before refreshing durable questions", async () => {
    const ownerId = await createUser("Finance question rulebook conflict");
    const workspace = createWorkspaceMaintenanceService({ db: database.db, now: () => now });
    let statusReads = 0;
    let questionRefreshes = 0;
    const changedRulebook =
      "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    const service = createFinanceMaintenanceService({
      finances: operations({
        refreshMaintenanceQuestionsForUser: async () => {
          questionRefreshes += 1;
          return { created: 0, total: 0 };
        },
      }),
      maintenance: workspace,
      now: () => now,
      status: {
        getFinanceStatus: async () => {
          statusReads += 1;
          return status(statusReads >= 6 ? changedRulebook : undefined);
        },
      },
    });
    const run = await service.startOrResume(ownerId, { type: "all_outstanding" });
    await service.dispatchRun(run.id);

    expect(questionRefreshes).toBe(0);
    await expect(service.getRun(ownerId, run.id)).resolves.toMatchObject({
      status: "failed_terminal",
    });
  });

  it("classifies unexpected persistence failure as recoverable and validation failure as terminal", async () => {
    const recoverableOwner = await createUser("Finance recoverable failure");
    const recoverableWorkspace = createWorkspaceMaintenanceService({
      db: database.db,
      now: () => now,
    });
    const recoverable = createFinanceMaintenanceService({
      finances: operations({
        syncDueAccountsForUser: async () => {
          throw new Error("database unavailable canary");
        },
      }),
      maintenance: recoverableWorkspace,
      now: () => now,
      status: { getFinanceStatus: async () => status() },
    });
    const recoverableRun = await recoverable.startOrResume(recoverableOwner, {
      type: "all_outstanding",
    });
    await recoverable.dispatchRun(recoverableRun.id);
    await expect(recoverable.getRun(recoverableOwner, recoverableRun.id)).resolves.toMatchObject({
      lastSafeError: {
        code: "finance_maintenance_failed",
        message: "Finance maintenance could not finish this step.",
      },
      status: "failed_recoverable",
    });
    await expect(recoverableWorkspace.listStepRecords(recoverableRun.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "completed", step: "preflight" }),
        expect.objectContaining({ status: "failed_recoverable", step: "synchronize" }),
      ]),
    );

    const terminalOwner = await createUser("Finance terminal failure");
    const terminalWorkspace = createWorkspaceMaintenanceService({
      db: database.db,
      now: () => now,
    });
    const terminal = createFinanceMaintenanceService({
      finances: operations({
        reconcileTransfersForUser: async () => {
          throw new AppError("invalid_request", "The Finance target is invalid.");
        },
      }),
      maintenance: terminalWorkspace,
      now: () => now,
      status: { getFinanceStatus: async () => status() },
    });
    const terminalRun = await terminal.startOrResume(terminalOwner, { type: "all_outstanding" });
    await terminal.dispatchRun(terminalRun.id);
    await expect(terminal.getRun(terminalOwner, terminalRun.id)).resolves.toMatchObject({
      lastSafeError: { code: "invalid_request", message: "The Finance target is invalid." },
      status: "failed_terminal",
    });

    const missingOwner = await createUser("Finance missing target");
    const missingWorkspace = createWorkspaceMaintenanceService({ db: database.db, now: () => now });
    const missing = createFinanceMaintenanceService({
      finances: operations({
        reconcileTransfersForUser: async () => {
          throw new AppError("not_found", "The Finance target was not found.");
        },
      }),
      maintenance: missingWorkspace,
      now: () => now,
      status: { getFinanceStatus: async () => status() },
    });
    const missingRun = await missing.startOrResume(missingOwner, {
      type: "target",
      entityType: "finance_account",
      id: crypto.randomUUID(),
    });
    await missing.dispatchRun(missingRun.id);
    await expect(missing.getRun(missingOwner, missingRun.id)).resolves.toMatchObject({
      lastSafeError: { code: "not_found" },
      status: "failed_terminal",
    });
  });

  it("keeps incomplete synchronization recoverable and does not run stale mutations", async () => {
    for (const [label, syncResult, sourceCurrent] of [
      ["failed", { attempted: 1, failed: 1, recovered: 0, skipped: 0, succeeded: 0 }, true],
      ["busy", { attempted: 1, failed: 0, recovered: 0, skipped: 1, succeeded: 0 }, true],
      ["non-current", { attempted: 0, failed: 0, recovered: 0, skipped: 0, succeeded: 0 }, false],
    ] as const) {
      const ownerId = await createUser(`Finance sync ${label}`);
      const workspace = createWorkspaceMaintenanceService({ db: database.db, now: () => now });
      let reconciliations = 0;
      let synchronized = false;
      const service = createFinanceMaintenanceService({
        finances: operations({
          reconcileTransfersForUser: async () => {
            reconciliations += 1;
            return { paired: 0, transfers: 0 };
          },
          syncDueAccountsForUser: async () => {
            synchronized = true;
            return syncResult;
          },
        }),
        maintenance: workspace,
        now: () => now,
        status: {
          getFinanceStatus: async () =>
            status(undefined, { nonCurrent: synchronized && !sourceCurrent }),
        },
      });
      const run = await service.startOrResume(ownerId, { type: "all_outstanding" });
      await service.dispatchRun(run.id);
      await expect(service.getRun(ownerId, run.id)).resolves.toMatchObject({
        status: "failed_recoverable",
      });
      expect(reconciliations).toBe(0);
      expect(await workspace.listStepRecords(run.id)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ status: "failed_recoverable", step: "synchronize" }),
        ]),
      );
      expect(await workspace.listStepRecords(run.id)).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ status: "completed", step: "synchronize" }),
        ]),
      );
    }
  });

  it("honors claim exclusion, failed apply results, and verification-only blockers", async () => {
    const claimedOwner = await createUser("Finance already claimed");
    const claimedWorkspace = createWorkspaceMaintenanceService({ db: database.db, now: () => now });
    const claimedService = createFinanceMaintenanceService({
      finances: operations(),
      maintenance: claimedWorkspace,
      now: () => now,
      status: { getFinanceStatus: async () => status() },
    });
    const claimedRun = await claimedService.startOrResume(claimedOwner, {
      type: "all_outstanding",
    });
    await claimedWorkspace.claim(claimedRun.id);
    await expect(claimedService.dispatchRun(claimedRun.id)).resolves.toBeNull();

    for (const [label, code, expectedStatus] of [
      ["validation", "invalid_request", "failed_terminal"],
      ["forbidden", "forbidden", "failed_terminal"],
      ["conflict", "conflict", "failed_recoverable"],
    ] as const) {
      const ownerId = await createUser(`Finance apply ${label}`);
      const workspace = createWorkspaceMaintenanceService({ db: database.db, now: () => now });
      const service = createFinanceMaintenanceService({
        finances: operations({
          applyApprovedOneOffs: async (input) =>
            input.decisions.map((decision) => ({
              applied: false,
              error: { code, message: `Categorization ${label}.`, requestId: "safe-request" },
              replayed: false,
              status: "failed" as const,
              threshold: null,
              transaction: null,
              transactionId: decision.transactionId,
            })),
          proposeOutstandingCategorizations: async () => ({
            items: [proposal(crypto.randomUUID(), { confidence: 1 })],
            nextCursor: null,
          }),
        }),
        maintenance: workspace,
        now: () => now,
        status: { getFinanceStatus: async () => status() },
      });
      const run = await service.startOrResume(ownerId, { type: "all_outstanding" });
      await service.dispatchRun(run.id);
      await expect(service.getRun(ownerId, run.id)).resolves.toMatchObject({
        status: expectedStatus,
      });
    }

    const verificationOwner = await createUser("Finance verification blocker");
    const verificationWorkspace = createWorkspaceMaintenanceService({
      db: database.db,
      now: () => now,
    });
    let verificationBlocked = false;
    const verificationService = createFinanceMaintenanceService({
      finances: operations({
        refreshCashflowForUser: async () => {
          verificationBlocked = true;
          return { refreshed: true };
        },
      }),
      maintenance: verificationWorkspace,
      now: () => now,
      status: {
        getFinanceStatus: async () => ({
          ...status(),
          state: verificationBlocked ? "blocked" : "needs_work",
        }),
      },
    });
    const verificationRun = await verificationService.startOrResume(verificationOwner, {
      type: "all_outstanding",
    });
    await verificationService.dispatchRun(verificationRun.id);
    await expect(
      verificationService.getRun(verificationOwner, verificationRun.id),
    ).resolves.toMatchObject({ status: "blocked" });

    verificationBlocked = false;
    await expect(
      verificationService.startOrResume(verificationOwner, { type: "all_outstanding" }),
    ).resolves.toMatchObject({ id: verificationRun.id, status: "queued" });
  });

  it("forwards narrow windows and exact targets to every Finance operation", async () => {
    const windowOwner = await createUser("Finance window scope");
    const observedScopes: MaintenanceScope[] = [];
    const windowScope = { type: "window", start: "2026-08-01", end: "2026-08-07" } as const;
    const windowService = createFinanceMaintenanceService({
      finances: operations({
        proposeOutstandingCategorizations: async (_userId, scope) => {
          observedScopes.push(scope);
          return { items: [], nextCursor: null };
        },
        reconcileTransfersForUser: async (_userId, scope) => {
          observedScopes.push(scope);
          return { paired: 0, transfers: 0 };
        },
        refreshMaintenanceQuestionsForUser: async (_userId, scope) => {
          observedScopes.push(scope);
          return { created: 0, total: 0 };
        },
      }),
      maintenance: createWorkspaceMaintenanceService({ db: database.db, now: () => now }),
      now: () => now,
      status: { getFinanceStatus: async () => status() },
    });
    const windowRun = await windowService.startOrResume(windowOwner, windowScope);
    await windowService.dispatchRun(windowRun.id);
    expect(observedScopes).toEqual([windowScope, windowScope, windowScope]);
    await expect(windowService.getRun(windowOwner, windowRun.id)).resolves.toMatchObject({
      scope: windowScope,
      status: "completed",
    });

    const targetOwner = await createUser("Finance target scope");
    const targetScope = {
      type: "target",
      entityType: "finance_transaction",
      id: "77777777-7777-4777-8777-777777777777",
    } as const;
    const targetScopes: MaintenanceScope[] = [];
    const targetService = createFinanceMaintenanceService({
      finances: operations({
        proposeOutstandingCategorizations: async (_userId, scope) => {
          targetScopes.push(scope);
          return { items: [], nextCursor: null };
        },
        reconcileTransfersForUser: async (_userId, scope) => {
          targetScopes.push(scope);
          return { paired: 0, transfers: 0 };
        },
        refreshMaintenanceQuestionsForUser: async (_userId, scope) => {
          targetScopes.push(scope);
          return { created: 0, total: 0 };
        },
      }),
      maintenance: createWorkspaceMaintenanceService({ db: database.db, now: () => now }),
      now: () => now,
      status: { getFinanceStatus: async () => status() },
    });
    const targetRun = await targetService.startOrResume(targetOwner, targetScope);
    await targetService.dispatchRun(targetRun.id);
    expect(targetScopes).toEqual([targetScope, targetScope, targetScope]);
  });
});
