import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import {
  auditEvents,
  createDatabaseClient,
  type DatabaseClient,
  financeAccounts,
  financeAlerts,
  financeBudgetPlans,
  financeCategories,
  financeCategoryRules,
  financeIncomeStreams,
  financeMaintenanceCandidateItems,
  financeMaintenanceCandidates,
  financeProfiles,
  financeRecurringObligations,
  financeReimbursements,
  financeReviewCases,
  financeTransactionAllocations,
  financeTransactions,
  migrateDatabase,
  users,
  workspaceMaintenanceRuns,
  workspaceMaintenanceSteps,
} from "@personal-os/database";
import type {
  FinanceCategorizationProposal,
  FinanceMaintenanceCandidateItemDraft,
  FinanceStatus,
  MaintenanceScope,
} from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { AppError } from "./errors.js";
import {
  createFinanceMaintenanceService,
  type FinanceMaintenanceOperations,
} from "./finance-maintenance-service.js";
import { createFinanceService } from "./finance-service.js";
import { createFinanceStatusService } from "./finance-status-service.js";
import { migrationsWithout } from "./test-migrations.js";
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

  it("upgrades the historical maintenance chain before parking active candidate runs", async () => {
    const migrations = resolve(process.cwd(), "packages/database/migrations");
    const oldMigrations = await migrationsWithout(migrations, "finance-maintenance-before-0063-", [
      "0063_finance_maintenance_candidates",
      "0064_finance_ledger_challenges",
      "0065_finance_period_reviews",
      "0066_finance_plan_versions",
      "0067_finance_ledger_protocol",
      "0068_finance_mutation_leases",
      "0069_finance_legacy_budget_backfill",
      "0070_calendar_stewardship_foundations",
      "0071_calendar_event_links",
      "0072_finance_account_semantics",
      "0072_texting",
      "0073_finance_account_semantics_recovery",
    ]);
    const upgradeContainer = await new PostgreSqlContainer("postgres:17.5-alpine")
      .withDatabase("personal_os")
      .withUsername("personal_os")
      .withPassword("personal_os")
      .start();
    const upgradeDatabase = createDatabaseClient(upgradeContainer.getConnectionUri());
    try {
      await migrateDatabase(upgradeDatabase.db, oldMigrations);
      const [upgradeUser] = await upgradeDatabase.db
        .insert(users)
        .values({
          displayName: "Maintenance upgrade",
          email: `maintenance-upgrade-${crypto.randomUUID()}@example.com`,
          passwordHash: "unused",
          planningTimezone: "UTC",
        })
        .returning();
      if (!upgradeUser) throw new Error("Upgrade migration user was not created.");

      await migrateDatabase(upgradeDatabase.db, migrations);
      const values = {
        domain: "finances" as const,
        rulebookVersion: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        scope: { type: "all_outstanding" as const },
        userId: upgradeUser.id,
      };
      await expect(
        upgradeDatabase.db.insert(workspaceMaintenanceRuns).values({
          ...values,
          checkpoint: { candidateId: crypto.randomUUID(), phase: "challenge" },
          status: "awaiting_agent_challenge",
        }),
      ).resolves.toBeDefined();
      await expect(
        upgradeDatabase.db.insert(workspaceMaintenanceRuns).values({
          ...values,
          checkpoint: { candidateId: crypto.randomUUID(), phase: "approval" },
          status: "awaiting_approval",
        }),
      ).rejects.toThrow();
    } finally {
      await upgradeDatabase.close();
      await upgradeContainer.stop();
      await rm(oldMigrations, { force: true, recursive: true });
    }
  }, 120_000);

  it("fresh migration accepts parked runs while retaining one active run invariant", async () => {
    const freshUserId = await createUser("Fresh parked maintenance");
    const values = {
      domain: "finances" as const,
      rulebookVersion: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      scope: { type: "all_outstanding" as const },
      userId: freshUserId,
    };
    await database.db.insert(workspaceMaintenanceRuns).values({
      ...values,
      checkpoint: { candidateId: crypto.randomUUID(), phase: "challenge" },
      status: "awaiting_agent_challenge",
    });
    await expect(
      database.db.insert(workspaceMaintenanceRuns).values({
        ...values,
        checkpoint: { candidateId: crypto.randomUUID(), phase: "approval" },
        status: "awaiting_approval",
      }),
    ).rejects.toThrow();
  });

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
      repairHeuristicTransfersForUser: async () => ({
        complete: true,
        inspected: 0,
        nextCursor: null,
        repaired: 0,
      }),
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
        repairHeuristicTransfersForUser: async () => ({
          complete: true,
          inspected: 0,
          nextCursor: null,
          repaired: 0,
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

  it("prepares one 47-item candidate without applying semantic categorization before challenge", async () => {
    const ownerId = await createUser("Real 47 Finance candidate");
    const workspace = createWorkspaceMaintenanceService({ db: database.db, now: () => now });
    const finances = createFinanceService({ db: database.db, now: () => now });
    const context = {
      principal: {
        actorId: ownerId,
        actorType: "user" as const,
        scopes: new Set(["finances:read" as const, "finances:write" as const]),
        userId: ownerId,
      },
      requestId: "real-47-finance-maintenance-fixture",
    };
    const account = await finances.createAccount(
      { balance: 10_000, institution: "Bank", kind: "cash", name: "Checking", provider: "manual" },
      context,
    );
    await finances.listCategories(ownerId);
    const preparedTransactions = await Promise.all(
      Array.from({ length: 41 }, (_, index) =>
        finances.createTransaction(
          {
            accountId: account.id,
            amount: 100 + index,
            category: null,
            categoryConfidence: null,
            date: "2026-08-14",
            direction: "expense",
            merchant: `Whole Foods ${index + 1}`,
            notes: null,
          },
          context,
        ),
      ),
    );
    const ambiguousTransactions = await Promise.all(
      ["CVS", "Amazon Marketplace", "Broad Everyday Store", "Mixed Diversity Merchant"].map(
        (merchant, index) =>
          finances.createTransaction(
            {
              accountId: account.id,
              amount: 200 + index,
              category: null,
              categoryConfidence: null,
              date: "2026-08-14",
              direction: "expense",
              merchant,
              notes: null,
            },
            context,
          ),
      ),
    );
    const reimbursement = await finances.createTransaction(
      {
        accountId: account.id,
        amount: 300,
        category: null,
        categoryConfidence: null,
        date: "2026-08-14",
        direction: "expense",
        merchant: "Shared Trip Expense",
        notes: null,
      },
      context,
    );
    const possibleTransfer = await finances.createTransaction(
      {
        accountId: account.id,
        amount: 400,
        category: null,
        categoryConfidence: null,
        date: "2026-08-14",
        direction: "expense",
        merchant: "Account Movement",
        notes: null,
      },
      context,
    );
    const allTransactionIds = [
      ...preparedTransactions.map((item) => item.id),
      ...ambiguousTransactions.map((item) => item.id),
      reimbursement.id,
      possibleTransfer.id,
    ];
    await database.db
      .update(financeTransactions)
      .set({
        category: null,
        categoryConfidence: null,
        categoryDecidedAt: null,
        categoryId: null,
        categorySource: null,
        needsReview: true,
        pending: false,
      })
      .where(inArray(financeTransactions.id, allTransactionIds));
    await database.db
      .update(financeTransactions)
      .set({ reconciliationStatus: "candidate" })
      .where(eq(financeTransactions.id, possibleTransfer.id));
    await database.db.insert(financeCategoryRules).values(
      Array.from({ length: 41 }, (_, index) => ({
        category: "Groceries",
        merchantNormalized: `whole foods ${index + 1}`,
        userId: ownerId,
      })),
    );
    await database.db.insert(financeReviewCases).values([
      {
        rationale: "This expense may be reimbursed by a travel companion.",
        reason: "possible_reimbursement",
        transactionId: reimbursement.id,
        userId: ownerId,
      },
      {
        rationale: "This movement may be an internal transfer.",
        reason: "possible_transfer",
        transactionId: possibleTransfer.id,
        userId: ownerId,
      },
    ]);
    const productionProposals = await finances.proposeOutstandingCategorizations(ownerId, {
      type: "all_outstanding",
    });
    expect(productionProposals.items.filter((item) => item.meetsPolicyThreshold)).toHaveLength(41);
    const snapshot = async () =>
      Promise.all([
        database.db
          .select()
          .from(financeTransactions)
          .where(eq(financeTransactions.userId, ownerId)),
        database.db
          .select()
          .from(financeTransactionAllocations)
          .where(eq(financeTransactionAllocations.userId, ownerId)),
        database.db
          .select()
          .from(financeReimbursements)
          .where(eq(financeReimbursements.userId, ownerId)),
        database.db
          .select()
          .from(financeCategoryRules)
          .where(eq(financeCategoryRules.userId, ownerId)),
        database.db.select().from(financeReviewCases).where(eq(financeReviewCases.userId, ownerId)),
        database.db.select().from(financeAlerts).where(eq(financeAlerts.userId, ownerId)),
        database.db.select().from(financeProfiles).where(eq(financeProfiles.userId, ownerId)),
        database.db.select().from(financeBudgetPlans).where(eq(financeBudgetPlans.userId, ownerId)),
      ]);
    const before = await snapshot();
    const financeStatus = createFinanceStatusService({
      assistant: {} as never,
      db: database.db,
      finances,
      goals: {} as never,
      maintenance: workspace,
      now: () => now,
    });
    const service = createFinanceMaintenanceService({
      finances,
      maintenance: workspace,
      now: () => now,
      status: financeStatus,
    });
    const run = await service.startOrResume(ownerId, { type: "all_outstanding" });
    await service.dispatchRun(run.id);
    await expect(service.getRun(ownerId, run.id)).resolves.toMatchObject({
      checkpoint: { phase: "challenge" },
      status: "awaiting_agent_challenge",
    });
    await expect(service.dispatchDue(5)).resolves.toMatchObject({ attempted: 0, claimed: 0 });
    const [candidate] = await database.db
      .select()
      .from(financeMaintenanceCandidates)
      .where(eq(financeMaintenanceCandidates.runId, run.id));
    if (!candidate) throw new Error("The real 47-item candidate was not saved.");
    const candidateItems = await database.db
      .select()
      .from(financeMaintenanceCandidateItems)
      .where(eq(financeMaintenanceCandidateItems.candidateId, candidate.id))
      .orderBy(financeMaintenanceCandidateItems.ordinal);
    expect(candidateItems).toHaveLength(47);
    expect(candidateItems.map((item) => item.ordinal)).toEqual(
      Array.from({ length: 47 }, (_, index) => index),
    );
    const firstCandidatePage = await finances.listMaintenanceCandidateItems(
      ownerId,
      candidate.id,
      undefined,
      25,
    );
    expect(firstCandidatePage.items.map((item) => item.ordinal)).toEqual(
      Array.from({ length: 25 }, (_, index) => index),
    );
    expect(firstCandidatePage.items[0]).not.toHaveProperty("privatePayload");
    const secondCandidatePage = await finances.listMaintenanceCandidateItems(
      ownerId,
      candidate.id,
      firstCandidatePage.nextCursor ?? undefined,
      25,
    );
    expect(secondCandidatePage.items.map((item) => item.ordinal)).toEqual(
      Array.from({ length: 22 }, (_, index) => index + 25),
    );
    expect(secondCandidatePage.nextCursor).toBeNull();
    expect(candidateItems.filter((item) => item.disposition === "prepared")).toHaveLength(41);
    expect(candidateItems.filter((item) => item.disposition === "question")).toHaveLength(6);
    const questionPayloads = candidateItems
      .filter((item) => item.disposition === "question")
      .map((item) => item.privatePayload as { underlyingAction: string; why: string });
    expect(questionPayloads.map((item) => item.underlyingAction).sort()).toEqual([
      "categorization",
      "categorization",
      "categorization",
      "categorization",
      "reimbursement",
      "transaction",
    ]);
    expect(questionPayloads.map((item) => item.why)).toEqual(
      expect.arrayContaining([
        "This expense may be reimbursed by a travel companion.",
        "This movement may be an internal transfer.",
      ]),
    );
    expect(candidateItems.every((item) => item.sourceRefs.length === 1)).toBe(true);
    expect(await snapshot()).toEqual(before);
    const fingerprints = candidateItems.map((item) => item.fingerprint);
    const retry = await service.startOrResume(ownerId, { type: "all_outstanding" });
    expect(retry.id).toBe(run.id);
    await service.dispatchRun(retry.id);
    await expect(
      database.db
        .select({ fingerprint: financeMaintenanceCandidateItems.fingerprint })
        .from(financeMaintenanceCandidateItems)
        .where(eq(financeMaintenanceCandidateItems.candidateId, candidate.id))
        .orderBy(financeMaintenanceCandidateItems.ordinal),
    ).resolves.toEqual(fingerprints.map((fingerprint) => ({ fingerprint })));
  });

  it("durably appends three candidate pages and replays or supersedes a crashed page safely", async () => {
    const ownerId = await createUser("Paged Finance candidate");
    const workspace = createWorkspaceMaintenanceService({ db: database.db, now: () => now });
    const finances = createFinanceService({ db: database.db, now: () => now });
    const run = await workspace.createOrResume(
      ownerId,
      "finances",
      { type: "all_outstanding" },
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    const draft = (index: number) => ({
      actionKind: "categorization" as const,
      assumptions: [],
      disposition: "prepared" as const,
      evidence: { confidence: 1, rationale: "Bounded fixture evidence." },
      expectedRevision: now.toISOString(),
      fingerprint: `sha256:${index.toString(16).padStart(64, "0")}`,
      privatePayload: {
        actionKind: "categorization" as const,
        input: {
          decisions: [
            {
              categoryId: categoryId,
              confidence: 1,
              expectedTransactionUpdatedAt: now.toISOString(),
              learnMerchant: "never" as const,
              rationale: "Bounded fixture evidence.",
              transactionId: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
            },
          ],
        },
      },
      safeChanges: [],
      sourceRefs: [
        {
          accountId: "33333333-3333-4333-8333-333333333333",
          provider: "local" as const,
          remoteId: `page-${index}`,
          revision: now.toISOString(),
          sourceType: "finance_transaction" as const,
        },
      ],
    });
    const [firstPage, secondPage, thirdPage] = [
      Array.from({ length: 40 }, (_, index) => draft(index + 1)),
      Array.from({ length: 40 }, (_, index) => draft(index + 41)),
      Array.from({ length: 21 }, (_, index) => draft(index + 81)),
    ];
    const first = await finances.beginMaintenanceCandidatePreparation({
      runId: run.id,
      userId: ownerId,
    });
    const pageOne = await finances.appendMaintenanceCandidatePage({
      cursor: first.cursor,
      discoveryRevision: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      items: firstPage,
      nextCursor: "page-2",
      runId: run.id,
      userId: ownerId,
    });
    expect(pageOne).toMatchObject({ nextOrdinal: 40, status: "appended" });
    await expect(
      finances.getMaintenanceCandidate(ownerId, first.candidateId),
    ).rejects.toMatchObject({
      code: "not_found",
    });
    const recovered = await finances.beginMaintenanceCandidatePreparation({
      runId: run.id,
      userId: ownerId,
    });
    expect(recovered).toMatchObject({
      candidateId: first.candidateId,
      cursor: "page-2",
      nextOrdinal: 40,
    });
    await expect(
      finances.appendMaintenanceCandidatePage({
        cursor: first.cursor,
        discoveryRevision:
          "sha256:1111111111111111111111111111111111111111111111111111111111111111",
        items: firstPage,
        nextCursor: "page-2",
        runId: run.id,
        userId: ownerId,
      }),
    ).resolves.toMatchObject({ status: "replayed", nextOrdinal: 40 });
    await finances.appendMaintenanceCandidatePage({
      cursor: "page-2",
      discoveryRevision: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
      items: secondPage,
      nextCursor: "page-3",
      runId: run.id,
      userId: ownerId,
    });
    await finances.appendMaintenanceCandidatePage({
      cursor: "page-3",
      discoveryRevision: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
      items: thirdPage,
      nextCursor: null,
      runId: run.id,
      userId: ownerId,
    });
    const finalized = await finances.finalizeMaintenanceCandidatePreparation({
      runId: run.id,
      userId: ownerId,
    });
    expect(finalized).toMatchObject({
      candidateId: first.candidateId,
      prepared: 101,
      questions: 0,
    });
    expect(finalized.fingerprints).toHaveLength(101);

    const driftOwnerId = await createUser("Drift Finance candidate");
    const driftRun = await workspace.createOrResume(
      driftOwnerId,
      "finances",
      {
        id: "10000000-0000-4000-8000-000000000001",
        type: "target",
        entityType: "finance_transaction",
      },
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    const drift = await finances.beginMaintenanceCandidatePreparation({
      runId: driftRun.id,
      userId: driftOwnerId,
    });
    await finances.appendMaintenanceCandidatePage({
      cursor: null,
      discoveryRevision: "sha256:4444444444444444444444444444444444444444444444444444444444444444",
      items: firstPage,
      nextCursor: "page-2",
      runId: driftRun.id,
      userId: driftOwnerId,
    });
    await expect(
      finances.appendMaintenanceCandidatePage({
        cursor: null,
        discoveryRevision:
          "sha256:5555555555555555555555555555555555555555555555555555555555555555",
        items: firstPage,
        nextCursor: "page-2",
        runId: driftRun.id,
        userId: driftOwnerId,
      }),
    ).resolves.toMatchObject({ candidateId: drift.candidateId, status: "superseded" });
    await expect(
      finances.beginMaintenanceCandidatePreparation({ runId: driftRun.id, userId: driftOwnerId }),
    ).resolves.toMatchObject({ cursor: null, nextOrdinal: 0 });
  });

  it("projects prepared candidate financial overlays without mutating canonical Finance records", async () => {
    const ownerId = await createUser("Projected Finance candidate");
    const workspace = createWorkspaceMaintenanceService({ db: database.db, now: () => now });
    const finances = createFinanceService({ db: database.db, now: () => now });
    const [account] = await database.db
      .insert(financeAccounts)
      .values({
        balance: 0,
        institution: "Projection Bank",
        kind: "cash",
        name: "Projection checking",
        provider: "manual",
        status: "manual",
        userId: ownerId,
      })
      .returning();
    const [groceries, travel] = await database.db
      .insert(financeCategories)
      .values([
        {
          group: "Spending",
          isSystem: false,
          name: "Groceries",
          slug: `groceries-${ownerId}`,
          userId: ownerId,
        },
        {
          group: "Spending",
          isSystem: false,
          name: "Travel",
          slug: `travel-${ownerId}`,
          userId: ownerId,
        },
      ])
      .returning();
    if (!account || !groceries || !travel) throw new Error("Projection fixtures were not created.");
    const [expense, outsideWindow] = await database.db
      .insert(financeTransactions)
      .values([
        {
          accountId: account.id,
          amount: 31_000,
          category: "Groceries",
          categoryId: groceries.id,
          direction: "expense",
          merchant: "Shared dinner",
          needsReview: false,
          pending: false,
          transactionDate: "2026-08-14",
          userId: ownerId,
        },
        {
          accountId: account.id,
          amount: 9_999,
          category: "Groceries",
          categoryId: groceries.id,
          direction: "expense",
          merchant: "Outside window",
          needsReview: false,
          pending: false,
          transactionDate: "2026-09-01",
          userId: ownerId,
        },
      ])
      .returning();
    if (!expense || !outsideWindow) throw new Error("Projection transactions were not created.");
    const [personalAllocation, reimbursableAllocation] = await database.db
      .insert(financeTransactionAllocations)
      .values([
        {
          allocationOrder: 0,
          amount: 9_000,
          categoryId: groceries.id,
          rationale: "Personal share.",
          transactionId: expense.id,
          treatment: "personal",
          userId: ownerId,
        },
        {
          allocationOrder: 1,
          amount: 22_000,
          categoryId: travel.id,
          rationale: "Companion share.",
          transactionId: expense.id,
          treatment: "reimbursable",
          userId: ownerId,
        },
      ])
      .returning();
    if (!personalAllocation || !reimbursableAllocation)
      throw new Error("Projection allocations were not created.");
    const [incomeStream] = await database.db
      .insert(financeIncomeStreams)
      .values({
        accountId: account.id,
        amountTolerance: 0,
        cadence: "monthly",
        confidence: 10_000,
        displayName: "Contract income",
        expectedAmount: 120_000,
        payer: "Client",
        source: "user",
        status: "paused",
        userId: ownerId,
      })
      .returning();
    const [recurring] = await database.db
      .insert(financeRecurringObligations)
      .values({
        accountId: account.id,
        amountTolerance: 0,
        cadence: "monthly",
        confidence: 10_000,
        displayName: "Rent",
        expectedAmount: 100_000,
        kind: "bill",
        merchant: "Landlord",
        source: "user",
        status: "paused",
        userId: ownerId,
      })
      .returning();
    if (!incomeStream || !recurring)
      throw new Error("Projection cashflow fixtures were not created.");
    const [profile] = await database.db
      .insert(financeProfiles)
      .values({
        effectiveDate: "2026-08-01",
        expectedNetPay: 400_000,
        payFrequency: "monthly",
        userId: ownerId,
      })
      .returning();
    if (!profile) throw new Error("Projection profile was not created.");
    const run = await workspace.createOrResume(
      ownerId,
      "finances",
      { type: "window", start: "2026-08-01", end: "2026-08-31" },
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    const fingerprint = (ordinal: number) => `sha256:${ordinal.toString(16).padStart(64, "0")}`;
    const draft = (
      ordinal: number,
      actionKind: FinanceMaintenanceCandidateItemDraft["actionKind"],
      input: Record<string, unknown>,
      safeChanges: Array<{ entityId: string | null; entityType: string; summary: string }> = [],
    ) =>
      ({
        actionKind,
        assumptions: [],
        disposition: "prepared",
        evidence: { confidence: 1, rationale: "Projection fixture evidence." },
        expectedRevision: now.toISOString(),
        fingerprint: fingerprint(ordinal),
        privatePayload: { actionKind, input },
        safeChanges,
        sourceRefs: [],
      }) as unknown as FinanceMaintenanceCandidateItemDraft;
    const items = [
      draft(
        1,
        "transaction_breakdown",
        {
          allocations: [
            {
              amount: 90,
              categoryId: groceries.id,
              rationale: "Personal share.",
              treatment: "personal",
            },
            {
              amount: 220,
              categoryId: travel.id,
              rationale: "Companion share.",
              treatment: "reimbursable",
            },
          ],
          expectedTransactionUpdatedAt: expense.updatedAt.toISOString(),
          futureRule: null,
          id: expense.id,
          rationale: "Split the shared dinner.",
        },
        [
          {
            entityId: expense.id,
            entityType: "finance_transaction",
            summary: "Split shared dinner.",
          },
        ],
      ),
      draft(2, "reimbursement", {
        allocationId: reimbursableAllocation.id,
        dueDate: null,
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
          summary: "Companion confirmed the share.",
        },
        expectedAmount: 220,
        operation: "create",
        payer: "Companion",
        rationale: "Track the companion reimbursement.",
      }),
      draft(3, "budget_plan", {
        acknowledgeOverAllocation: false,
        allocations: [{ categoryId: groceries.id, limit: 150 }],
        assumptions: [],
        goalIds: [],
        month: "2026-08",
        rationale: "August grocery budget.",
        replace: true,
        scenarioFingerprint: null,
      }),
      draft(4, "transaction", {
        accountId: account.id,
        amount: 77,
        category: null,
        categoryConfidence: null,
        date: "2026-08-20",
        direction: "income",
        merchant: "Manual credit",
        notes: null,
      }),
      draft(
        5,
        "transaction",
        {
          category: "Travel",
          id: expense.id,
          rationale: "Correct the transaction category.",
        },
        [{ entityId: expense.id, entityType: "finance_transaction", summary: "Correct category." }],
      ),
      draft(6, "profile", {
        effectiveDate: "2026-08-01",
        expectedNetPay: 5000,
        payFrequency: "monthly",
      }),
      draft(7, "income_stream", { id: incomeStream.id, status: "active" }, [
        {
          entityId: incomeStream.id,
          entityType: "finance_income_stream",
          summary: "Resume income.",
        },
      ]),
      draft(8, "recurring_obligation", { id: recurring.id, status: "active" }, [
        {
          entityId: recurring.id,
          entityType: "finance_recurring_obligation",
          summary: "Resume rent.",
        },
      ]),
      draft(9, "merchant", { displayName: "Shared dinner", id: crypto.randomUUID() }),
      draft(10, "alert", { action: "resolve", id: crypto.randomUUID(), rationale: null }),
    ];
    const before = await database.db
      .select({ amount: financeTransactions.amount, category: financeTransactions.category })
      .from(financeTransactions)
      .where(eq(financeTransactions.id, expense.id));
    const prepared = await finances.beginMaintenanceCandidatePreparation({
      runId: run.id,
      userId: ownerId,
    });
    await expect(
      finances.appendMaintenanceCandidatePage({
        cursor: prepared.cursor,
        discoveryRevision:
          "sha256:1111111111111111111111111111111111111111111111111111111111111111",
        items,
        nextCursor: null,
        runId: run.id,
        userId: ownerId,
      }),
    ).resolves.toMatchObject({ status: "appended" });
    const finalized = await finances.finalizeMaintenanceCandidatePreparation({
      runId: run.id,
      userId: ownerId,
    });
    const candidate = await finances.getMaintenanceCandidate(ownerId, finalized.candidateId);
    expect(candidate.projection).toMatchObject({
      budgetActual: 90,
      budgetTotal: 150,
      budgetVariance: -60,
      grossCashSpending: 310,
      monthlyCapacity: 4000,
      plannedIncome: 1200,
      profileExpectedNetIncome: 5000,
      personalSpending: 90,
      recurringCommittedOutflow: 1000,
      reimbursementsOutstanding: 220,
      workItems: 2,
    });
    await expect(
      database.db
        .select({ amount: financeTransactions.amount, category: financeTransactions.category })
        .from(financeTransactions)
        .where(eq(financeTransactions.id, expense.id)),
    ).resolves.toEqual(before);
    await expect(
      database.db
        .select({ status: financeIncomeStreams.status })
        .from(financeIncomeStreams)
        .where(eq(financeIncomeStreams.id, incomeStream.id)),
    ).resolves.toEqual([{ status: "paused" }]);
    await expect(
      database.db
        .select({ status: financeRecurringObligations.status })
        .from(financeRecurringObligations)
        .where(eq(financeRecurringObligations.id, recurring.id)),
    ).resolves.toEqual([{ status: "paused" }]);
    await database.db
      .update(financeProfiles)
      .set({ expectedNetPay: 410_000, updatedAt: new Date(now.getTime() + 1) })
      .where(eq(financeProfiles.id, profile.id));
    await database.db
      .update(financeMaintenanceCandidates)
      .set({ state: "superseded" })
      .where(eq(financeMaintenanceCandidates.id, finalized.candidateId));
    const retry = await finances.beginMaintenanceCandidatePreparation({
      runId: run.id,
      userId: ownerId,
    });
    await finances.appendMaintenanceCandidatePage({
      cursor: retry.cursor,
      discoveryRevision: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      items,
      nextCursor: null,
      runId: run.id,
      userId: ownerId,
    });
    const afterSourceDrift = await finances.finalizeMaintenanceCandidatePreparation({
      runId: run.id,
      userId: ownerId,
    });
    expect(afterSourceDrift.revision).not.toBe(finalized.revision);
  });

  it("projects a partial reimbursement match and preserves invalidated allocations as pending input", async () => {
    const ownerId = await createUser("Partial projection candidate");
    const workspace = createWorkspaceMaintenanceService({ db: database.db, now: () => now });
    const finances = createFinanceService({ db: database.db, now: () => now });
    const [account] = await database.db
      .insert(financeAccounts)
      .values({
        balance: 0,
        institution: "Projection Bank",
        kind: "cash",
        name: "Projection checking",
        provider: "manual",
        status: "manual",
        userId: ownerId,
      })
      .returning();
    const [category] = await database.db
      .insert(financeCategories)
      .values({
        group: "Spending",
        isSystem: false,
        name: "Travel",
        slug: `partial-travel-${ownerId}`,
        userId: ownerId,
      })
      .returning();
    if (!account || !category) throw new Error("Partial projection fixtures were not created.");
    const [expense] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: account.id,
        amount: 31_000,
        category: "Travel",
        categoryId: category.id,
        direction: "expense",
        merchant: "Shared stay",
        needsReview: false,
        pending: false,
        transactionDate: "2026-08-14",
        userId: ownerId,
      })
      .returning();
    if (!expense) throw new Error("Partial projection transaction was not created.");
    const [allocation] = await database.db
      .insert(financeTransactionAllocations)
      .values({
        allocationOrder: 0,
        amount: 31_000,
        categoryId: category.id,
        rationale: "Awaiting receipt.",
        state: "invalidated",
        invalidatedAt: now,
        transactionId: expense.id,
        treatment: "reimbursable",
        userId: ownerId,
      })
      .returning();
    if (!allocation) throw new Error("Partial projection allocation was not created.");
    const [reimbursement] = await database.db
      .insert(financeReimbursements)
      .values({
        allocationId: allocation.id,
        evidence: {},
        expectedAmount: 22000,
        payer: "Companion",
        rationale: "Original reimbursement.",
        status: "expected",
        userId: ownerId,
      })
      .returning();
    if (!reimbursement) throw new Error("Partial projection reimbursement was not created.");
    const [credit] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: account.id,
        amount: 5_000,
        category: null,
        direction: "income",
        merchant: "Companion",
        needsReview: false,
        pending: false,
        transactionDate: "2026-08-15",
        userId: ownerId,
      })
      .returning();
    if (!credit) throw new Error("Partial projection credit was not created.");
    const run = await workspace.createOrResume(
      ownerId,
      "finances",
      { type: "window", start: "2026-08-01", end: "2026-08-31" },
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    const item = {
      actionKind: "reimbursement" as const,
      assumptions: [],
      disposition: "prepared" as const,
      evidence: { confidence: 1, rationale: "Credit amount is exact." },
      expectedRevision: now.toISOString(),
      fingerprint: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      privatePayload: {
        actionKind: "reimbursement" as const,
        input: {
          amount: 50,
          creditTransactionId: credit.id,
          evidence: {
            sourceRefs: [
              {
                accountId: account.id,
                provider: "local" as const,
                remoteId: credit.id,
                revision: credit.updatedAt.toISOString(),
                sourceType: "finance_transaction" as const,
              },
            ],
            summary: "Companion payment.",
          },
          expectedRevision: reimbursement.revision,
          operation: "match_credit" as const,
          rationale: "Apply the partial reimbursement.",
          reimbursementId: reimbursement.id,
        },
      },
      safeChanges: [],
      sourceRefs: [],
    } satisfies FinanceMaintenanceCandidateItemDraft;
    const question = {
      actionKind: "question" as const,
      assumptions: [],
      disposition: "question" as const,
      evidence: { confidence: 1, rationale: "The invalidated allocation requires confirmation." },
      expectedRevision: now.toISOString(),
      fingerprint: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      privatePayload: {
        asOf: now.toISOString(),
        choices: [],
        expectedAnswer: [],
        prompt: "Confirm how the invalidated travel allocation should be handled.",
        transactionId: expense.id,
        underlyingAction: "reimbursement" as const,
        why: "The provider amount changed after the allocation was prepared.",
      },
      safeChanges: [],
      sourceRefs: [],
    } satisfies FinanceMaintenanceCandidateItemDraft;
    const prepared = await finances.beginMaintenanceCandidatePreparation({
      runId: run.id,
      userId: ownerId,
    });
    await finances.appendMaintenanceCandidatePage({
      cursor: prepared.cursor,
      discoveryRevision: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
      items: [item, question],
      nextCursor: null,
      runId: run.id,
      userId: ownerId,
    });
    const finalized = await finances.finalizeMaintenanceCandidatePreparation({
      runId: run.id,
      userId: ownerId,
    });
    const candidate = await finances.getMaintenanceCandidate(ownerId, finalized.candidateId);
    expect(candidate.projection).toMatchObject({
      grossCashSpending: 310,
      matchedReimbursementIncome: 50,
      personalSpending: 0,
      questions: 1,
      reimbursementsOutstanding: 170,
    });
    await expect(
      database.db
        .select({ receivedAmount: financeReimbursements.receivedAmount })
        .from(financeReimbursements)
        .where(eq(financeReimbursements.id, reimbursement.id)),
    ).resolves.toEqual([{ receivedAmount: 0 }]);
  });

  it("prefers the authoritative question-step creation count over reviews created during reconciliation", async () => {
    const ownerId = await createUser("Finance refreshed question count");
    const workspace = createWorkspaceMaintenanceService({ db: database.db, now: () => now });
    const reconciliationReviewIds = [crypto.randomUUID(), crypto.randomUUID()];
    const service = createFinanceMaintenanceService({
      finances: operations({
        reconcileTransfersForUser: async (_userId, _scope, context) => {
          if (!context) throw new Error("Maintenance attribution was not supplied.");
          await database.db.insert(auditEvents).values(
            reconciliationReviewIds.map((entityId) => ({
              action: "finance.review_queued",
              actorId: context.principal.actorId,
              actorType: context.principal.actorType,
              after: { maintenance: context.maintenance },
              before: null,
              entityId,
              entityType: "finance_review_case",
              requestId: context.requestId,
              userId: ownerId,
            })),
          );
          return { paired: 0, transfers: 0 };
        },
        refreshMaintenanceQuestionsForUser: async () => ({ created: 0, total: 1 }),
        summarizeMaintenanceEffectsForRun: async (_userId, runId) => {
          const rows = await database.db
            .select({ entityId: auditEvents.entityId, requestId: auditEvents.requestId })
            .from(auditEvents)
            .where(
              and(
                eq(auditEvents.userId, ownerId),
                eq(auditEvents.action, "finance.review_queued"),
                like(auditEvents.requestId, `maintenance:${runId}:%`),
              ),
            );
          return {
            categorizations: 0,
            duplicateActions: 0,
            questionStepCreations: new Set(
              rows
                .filter((row) => row.requestId === `maintenance:${runId}:questions`)
                .map((row) => row.entityId),
            ).size,
            questions: new Set(rows.map((row) => row.entityId)).size,
            transfers: 0,
          };
        },
      }),
      maintenance: workspace,
      now: () => now,
      status: { getFinanceStatus: async () => status(undefined, { questions: 1 }) },
    });
    const run = await service.startOrResume(ownerId, { type: "all_outstanding" });

    await service.dispatchRun(run.id);

    const awaitingChallenge = await service.getRun(ownerId, run.id);
    expect(awaitingChallenge).toMatchObject({
      settledResult: { questions: { created: 0, total: 1 } },
      status: "completed_with_questions",
    });
    await expect(
      database.db
        .select({ entityId: auditEvents.entityId })
        .from(auditEvents)
        .where(eq(auditEvents.requestId, `maintenance:${run.id}:reconcile`)),
    ).resolves.toHaveLength(2);
    await expect(workspace.listStepRecords(run.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ result: { created: 0, total: 1 }, step: "questions" }),
      ]),
    );
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
    const awaitingChallenge = await service.getRun(ownerId, run.id);
    expect(awaitingChallenge).toMatchObject({
      checkpoint: { phase: "challenge" },
      settledResult: null,
      status: "awaiting_agent_challenge",
    });
    const candidates = await database.db
      .select()
      .from(financeMaintenanceCandidates)
      .where(eq(financeMaintenanceCandidates.runId, run.id));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ state: "ready_for_challenge", userId: ownerId });
    const candidate = candidates[0];
    if (!candidate) throw new Error("Candidate fixture was not saved.");
    const publicCandidate = await finances.getMaintenanceCandidate(ownerId, candidate.id);
    expect(publicCandidate).toMatchObject({
      id: candidate.id,
      userId: ownerId,
    });
    expect(publicCandidate).not.toHaveProperty("preparationCursor");
    expect(publicCandidate).not.toHaveProperty("preparationCheckpoint");
    expect(typeof publicCandidate.createdAt).toBe("string");
    expect(typeof publicCandidate.updatedAt).toBe("string");
    const candidatePage = await finances.listMaintenanceCandidateItems(
      ownerId,
      candidate.id,
      undefined,
      2,
    );
    expect(candidatePage.items).toHaveLength(2);
    expect(candidatePage.nextCursor).toEqual(expect.any(String));
    expect(candidatePage.items[0]).not.toHaveProperty("privatePayload");
    expect(typeof candidatePage.items[0]?.createdAt).toBe("string");
    expect(typeof candidatePage.items[0]?.updatedAt).toBe("string");
    await expect(
      finances.getMaintenanceCandidate("00000000-0000-4000-8000-000000000001", candidate.id),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      database.db
        .select({ fingerprint: financeMaintenanceCandidateItems.fingerprint })
        .from(financeMaintenanceCandidateItems)
        .where(eq(financeMaintenanceCandidateItems.candidateId, candidate.id)),
    ).resolves.toHaveLength(6);
    const retry = await service.startOrResume(ownerId, { type: "all_outstanding" });
    expect(retry.id).toBe(run.id);
    // Candidate preparation is intentionally the terminal point for this
    // pre-challenge test. Settlement belongs to the challenge lifecycle.
    if (awaitingChallenge.status === "queued") return;
    await expect(finances.summarizeMaintenanceEffectsForRun(ownerId, run.id)).resolves.toEqual({
      categorizations: 0,
      duplicateActions: 0,
      heuristicTransfersRepaired: 0,
      questionStepCreations: 0,
      questions: 0,
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
      category: null,
    });
    expect(appliedRows.find((row) => row.id === oneOffCandidate.id)).toMatchObject({
      category: null,
    });
    expect(appliedRows.filter((row) => [transferOut.id, transferIn.id].includes(row.id))).toEqual([
      expect.objectContaining({ category: "Transfers" }),
      expect.objectContaining({ category: "Transfers" }),
    ]);
    const questionsAfterFirst = await database.db
      .select({ id: financeReviewCases.id, reason: financeReviewCases.reason })
      .from(financeReviewCases)
      .where(eq(financeReviewCases.userId, ownerId));
    expect(questionsAfterFirst).toEqual([]);
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
      expect.arrayContaining(["finance.transfer_reconciled"]),
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
      checkpoint: { phase: "challenge" },
      settledResult: null,
      status: "awaiting_agent_challenge",
    });
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

  it("recovers a committed bounded legacy-transfer repair before its durable checkpoint", async () => {
    const ownerId = await createUser("Finance transfer repair continuation");
    const workspaceOne = createWorkspaceMaintenanceService({ db: database.db, now: () => now });
    const repairCursors: Array<string | undefined> = [];
    const financeOperations = operations({
      repairHeuristicTransfersForUser: async (_userId, _scope, cursor, context) => {
        repairCursors.push(cursor);
        const committedPages = await database.db
          .select({ id: auditEvents.id })
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.userId, ownerId),
              eq(auditEvents.action, "fixture.transfer_heuristic_repaired"),
            ),
          );
        const page = cursor ? 3 : committedPages.length >= 100 ? 2 : 1;
        const pageSize = page === 3 ? 1 : 100;
        await database.db.insert(auditEvents).values(
          Array.from({ length: pageSize }, () => ({
            action: "fixture.transfer_heuristic_repaired",
            actorId: context.principal.actorId,
            actorType: context.principal.actorType,
            after: { maintenance: context.maintenance },
            before: null,
            entityId: crypto.randomUUID(),
            entityType: "finance_transaction",
            requestId: context.requestId,
            userId: ownerId,
          })),
        );
        return page === 3
          ? { complete: true, inspected: 1, nextCursor: null, repaired: 1 }
          : {
              complete: false,
              inspected: 100,
              nextCursor: `repair-page-${page}`,
              repaired: 100,
            };
      },
      summarizeMaintenanceEffectsForRun: async (userId, runId) => {
        const rows = await database.db
          .select({ action: auditEvents.action, entityId: auditEvents.entityId })
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.userId, userId),
              eq(auditEvents.action, "fixture.transfer_heuristic_repaired"),
              like(auditEvents.requestId, `maintenance:${runId}:%`),
            ),
          );
        return {
          categorizations: 0,
          duplicateActions: rows.length - new Set(rows.map((row) => row.entityId)).size,
          heuristicTransfersRepaired: new Set(rows.map((row) => row.entityId)).size,
          questions: 0,
          transfers: 0,
        };
      },
    });
    let loseProcess = true;
    const crashingMaintenance = {
      ...workspaceOne,
      checkpointAndRelease: async (
        input: Parameters<typeof workspaceOne.checkpointAndRelease>[0],
      ) => {
        if (loseProcess && (input.checkpoint as { step?: string }).step === "reconcile") {
          loseProcess = false;
          throw new Error("process exited after transfer repair commit");
        }
        return workspaceOne.checkpointAndRelease(input);
      },
      failStep: async () => {
        throw new Error("process exited before failure settlement");
      },
    };
    const firstRuntime = createFinanceMaintenanceService({
      finances: financeOperations,
      maintenance: crashingMaintenance,
      now: () => now,
      status: { getFinanceStatus: async () => status() },
    });
    const run = await firstRuntime.startOrResume(ownerId, { type: "all_outstanding" });

    await expect(firstRuntime.dispatchRun(run.id)).rejects.toThrow(
      "process exited before failure settlement",
    );
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({ leaseExpiresAt: sql`NOW() - INTERVAL '1 second'` })
      .where(eq(workspaceMaintenanceRuns.id, run.id));
    const recoveredRuntime = createFinanceMaintenanceService({
      finances: financeOperations,
      maintenance: createWorkspaceMaintenanceService({ db: database.db, now: () => now }),
      now: () => now,
      status: { getFinanceStatus: async () => status() },
    });
    await recoveredRuntime.dispatchRun(run.id);
    const recovered = await recoveredRuntime.getRun(ownerId, run.id);
    expect(recovered.lastSafeError).toBeNull();
    expect(recovered).toMatchObject({
      checkpoint: { cursor: "repair-page-2", repaired: 200, step: "reconcile" },
      status: "queued",
    });
    await recoveredRuntime.dispatchRun(run.id);
    await expect(recoveredRuntime.getRun(ownerId, run.id)).resolves.toMatchObject({
      status: "completed",
    });
    expect(repairCursors).toEqual([undefined, undefined, "repair-page-2"]);
    await expect(
      database.db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(eq(auditEvents.action, "fixture.transfer_heuristic_repaired")),
    ).resolves.toHaveLength(201);
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

  it("reconstructs the original created-question count after review commit and process loss", async () => {
    const ownerId = await createUser("Finance question effect recovery");
    const finances = createFinanceService({ db: database.db, now: () => now });
    delete (finances as { prepareMaintenanceCandidate?: unknown }).prepareMaintenanceCandidate;
    const context = {
      principal: {
        actorId: ownerId,
        actorType: "user" as const,
        scopes: new Set(["finances:read" as const, "finances:write" as const]),
        userId: ownerId,
      },
      requestId: "question-effect-recovery-fixture",
    };
    const account = await finances.createAccount(
      { balance: 0, institution: "Bank", kind: "cash", name: "Checking", provider: "manual" },
      context,
    );
    for (let index = 0; index < 2; index += 1) {
      await finances.createTransaction(
        {
          accountId: account.id,
          amount: 44,
          category: null,
          categoryConfidence: null,
          date: "2026-08-12",
          direction: "expense",
          merchant: "Duplicate recovery purchase",
          notes: null,
        },
        { ...context, requestId: `${context.requestId}:${index}` },
      );
    }
    const workspace = createWorkspaceMaintenanceService({ db: database.db, now: () => now });
    let crashOnQuestions = true;
    const crashingWorkspace = {
      ...workspace,
      async completeStep(input: Parameters<typeof workspace.completeStep>[0]) {
        if (input.step === "questions" && crashOnQuestions) {
          crashOnQuestions = false;
          throw new Error("process exited after question commit");
        }
        return workspace.completeStep(input);
      },
      async failStep(input: Parameters<typeof workspace.failStep>[0]) {
        if (input.step === "questions" && !crashOnQuestions) {
          throw new Error("process exited after question commit");
        }
        return workspace.failStep(input);
      },
    };
    const financeStatus = createFinanceStatusService({
      assistant: {} as never,
      db: database.db,
      finances,
      goals: {} as never,
      maintenance: workspace,
      now: () => now,
    });
    const firstRuntime = createFinanceMaintenanceService({
      finances,
      maintenance: crashingWorkspace,
      now: () => now,
      status: financeStatus,
    });
    const run = await firstRuntime.startOrResume(ownerId, { type: "all_outstanding" });
    await expect(firstRuntime.dispatchRun(run.id)).rejects.toThrow(
      "process exited after question commit",
    );
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({ leaseExpiresAt: sql`NOW() - INTERVAL '1 second'` })
      .where(eq(workspaceMaintenanceRuns.id, run.id));
    const recoveredRuntime = createFinanceMaintenanceService({
      finances,
      maintenance: workspace,
      now: () => now,
      status: financeStatus,
    });
    await recoveredRuntime.dispatchRun(run.id);

    await expect(recoveredRuntime.getRun(ownerId, run.id)).resolves.toMatchObject({
      settledResult: { questions: { created: 1, total: 1 } },
      status: "completed_with_questions",
    });
    await expect(
      database.db
        .select({ action: auditEvents.action })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.requestId, `maintenance:${run.id}:questions`),
            eq(auditEvents.action, "finance.review_queued"),
          ),
        ),
    ).resolves.toHaveLength(1);
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
        getFinanceStatus: async () => {
          const observed = status(undefined, { blocked: sourceBlocked });
          return sourceBlocked
            ? {
                ...observed,
                details: {
                  ...observed.details,
                  health: { ...observed.details.health, confidence: "reliable" },
                },
              }
            : observed;
        },
      },
    });
    const run = await service.startOrResume(ownerId, { type: "all_outstanding" });
    await service.dispatchRun(run.id);

    await expect(service.getRun(ownerId, run.id)).resolves.toMatchObject({
      retryAt: null,
      settledResult: {
        health: { applicability: "not_run", confidence: "insufficient", refreshed: false },
      },
      status: "blocked",
    });
    await expect(
      database.db
        .select({ settledResult: workspaceMaintenanceRuns.settledResult })
        .from(workspaceMaintenanceRuns)
        .where(eq(workspaceMaintenanceRuns.id, run.id)),
    ).resolves.toEqual([
      {
        settledResult: expect.objectContaining({
          health: { applicability: "not_run", confidence: "insufficient", refreshed: false },
        }),
      },
    ]);
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
        refreshCashflowForUser: async (_userId, scope) => {
          observedScopes.push(scope);
          return { refreshed: scope.type === "all_outstanding" };
        },
        syncDueAccountsForUser: async (_userId, scope) => {
          observedScopes.push(scope);
          return { attempted: 0, failed: 0, recovered: 0, skipped: 0, succeeded: 0 };
        },
      }),
      maintenance: createWorkspaceMaintenanceService({ db: database.db, now: () => now }),
      now: () => now,
      status: { getFinanceStatus: async () => status() },
    });
    const windowRun = await windowService.startOrResume(windowOwner, windowScope);
    await windowService.dispatchRun(windowRun.id);
    expect(observedScopes).toEqual([
      windowScope,
      windowScope,
      windowScope,
      windowScope,
      windowScope,
    ]);
    await expect(windowService.getRun(windowOwner, windowRun.id)).resolves.toMatchObject({
      scope: windowScope,
      settledResult: {
        health: {
          applicability: "skipped_scoped",
          confidence: "reliable",
          refreshed: false,
        },
      },
      status: "completed",
    });
    await expect(
      createWorkspaceMaintenanceService({ db: database.db, now: () => now }).listStepRecords(
        windowRun.id,
      ),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          result: {
            applicability: "skipped_scoped",
            confidence: "reliable",
            refreshed: false,
          },
          step: "health",
        }),
      ]),
    );

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
        refreshCashflowForUser: async (_userId, scope) => {
          targetScopes.push(scope);
          return { refreshed: scope.type === "all_outstanding" };
        },
        syncDueAccountsForUser: async (_userId, scope) => {
          targetScopes.push(scope);
          return { attempted: 0, failed: 0, recovered: 0, skipped: 0, succeeded: 0 };
        },
      }),
      maintenance: createWorkspaceMaintenanceService({ db: database.db, now: () => now }),
      now: () => now,
      status: { getFinanceStatus: async () => status() },
    });
    const targetRun = await targetService.startOrResume(targetOwner, targetScope);
    await targetService.dispatchRun(targetRun.id);
    expect(targetScopes).toEqual([targetScope, targetScope, targetScope, targetScope, targetScope]);
  });
});
