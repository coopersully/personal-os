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
import { eq, inArray, sql } from "drizzle-orm";
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
      "0072_finance_parallel_migration_reconciliation",
      "0073_task_organization_reconciliation",
      "0072_finance_account_semantics",
      "0072_texting",
      "0073_texting_review_hardening",
      "0073_finance_account_semantics_recovery",
      "0074_finance_budget_buckets",
      "0075_finance_ownership_constraint",
      "0076_task_list_icons",
      "0077_desktop_mail_activity",
      "0073_mail_workspace_stewardship",
      "0078_mail_workspace_stewardship_reconciliation",
      "0079_mail_stewardship_integrity",
      "0080_mail_reply_metadata",
      "0081_finance_legacy_disconnect_repair",
      "0082_finance_maintenance_lineage",
      "0083_global_execution_policy",
      "0084_finance_setup_profile_lineage",
      "0085_finance_context_capture",
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
    options: {
      blocked?: boolean;
      nonCurrent?: boolean;
      questions?: number;
      state?: FinanceStatus["state"];
    } = {},
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
      state: options.blocked ? "blocked" : (options.state ?? "needs_work"),
    } as unknown as FinanceStatus;
  }

  function requiredServices() {
    return {
      actions: { settleFinanceMaintenanceCandidate: vi.fn(async () => ({ status: "committed" })) },
      challenge: {
        prepare: vi.fn(async () => ({ id: crypto.randomUUID() })),
        resolve: vi.fn(async () => ({
          candidateId: crypto.randomUUID(),
          candidateRevision: `sha256:${"a".repeat(64)}`,
          questions: 0,
        })),
      },
      periodReviews: {
        createForRun: vi.fn(async () => ({ id: crypto.randomUUID(), status: "completed" })),
      },
    };
  }

  function operations(
    overrides: Partial<FinanceMaintenanceOperations> = {},
  ): FinanceMaintenanceOperations {
    const preparations = new Map<
      string,
      {
        candidateId: string;
        cursor: string | null;
        items: FinanceMaintenanceCandidateItemDraft[];
        complete: boolean;
      }
    >();
    return {
      beginMaintenanceCandidatePreparation: async ({ runId }) => {
        const preparation = preparations.get(runId) ?? {
          candidateId: crypto.randomUUID(),
          cursor: null,
          items: [],
          complete: false,
        };
        preparations.set(runId, preparation);
        return { ...preparation, nextOrdinal: preparation.items.length };
      },
      appendMaintenanceCandidatePage: async ({ runId, items, nextCursor }) => {
        const preparation = preparations.get(runId);
        if (!preparation) throw new Error("Preparation missing.");
        preparation.items.push(...items);
        preparation.cursor = nextCursor;
        preparation.complete = nextCursor === null;
        return {
          candidateId: preparation.candidateId,
          nextOrdinal: preparation.items.length,
          status: "appended",
        };
      },
      finalizeMaintenanceCandidatePreparation: async ({ runId }) => {
        const preparation = preparations.get(runId);
        if (!preparation) throw new Error("Preparation missing.");
        return {
          candidateId: preparation.candidateId,
          fingerprints: preparation.items.map((item) => item.fingerprint),
          prepared: preparation.items.filter((item) => item.disposition === "prepared").length,
          questions: preparation.items.filter((item) => item.disposition === "question").length,
          revision: `sha256:${"a".repeat(64)}`,
        };
      },
      getMaintenanceCandidateQuestionContexts: async () => ({}),
      projectMaintenanceCandidateQuestionsForUser: async () => ({ created: 0, total: 0 }),
      reconcileExactTransfersForUser: async () => ({ paired: 0, transfers: 0 }),
      summarizeMaintenanceEffectsForRun: async () => ({
        categorizations: 0,
        duplicateActions: 0,
        transfers: 0,
      }),
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
      ...requiredServices(),
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
      ...requiredServices(),
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

  it("settles explicit source blockers durably blocked without preserving a false checkpoint", async () => {
    const ownerId = await createUser("Finance blocked sync");
    const workspace = createWorkspaceMaintenanceService({ db: database.db, now: () => now });
    let sourceBlocked = false;
    const service = createFinanceMaintenanceService({
      ...requiredServices(),
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
      ...requiredServices(),
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
      ...requiredServices(),
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
      ...requiredServices(),
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
      ...requiredServices(),
      finances: operations({
        reconcileExactTransfersForUser: async () => {
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
      ...requiredServices(),
      finances: operations({
        reconcileExactTransfersForUser: async () => {
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
        ...requiredServices(),
        finances: operations({
          reconcileExactTransfersForUser: async () => {
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

  async function resumeAfterChallenge(
    workspace: ReturnType<typeof createWorkspaceMaintenanceService>,
    runId: string,
  ) {
    const run = await database.db
      .select()
      .from(workspaceMaintenanceRuns)
      .where(eq(workspaceMaintenanceRuns.id, runId));
    expect(run[0]?.status).toBe("awaiting_agent_challenge");
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({ status: "queued", checkpoint: { phase: "challenge_resolve" } })
      .where(eq(workspaceMaintenanceRuns.id, runId));
    expect(await workspace.listStepRecords(runId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ step: "challenge_prepare", status: "completed" }),
      ]),
    );
  }

  it("requires every canonical capability and never falls back to direct ledger writes", async () => {
    for (const missing of [
      "beginMaintenanceCandidatePreparation",
      "appendMaintenanceCandidatePage",
      "finalizeMaintenanceCandidatePreparation",
      "getMaintenanceCandidateQuestionContexts",
      "projectMaintenanceCandidateQuestionsForUser",
      "reconcileExactTransfersForUser",
      "summarizeMaintenanceEffectsForRun",
      "refreshCashflowForUser",
      "actions",
      "challenge",
      "periodReviews",
    ] as const) {
      const ownerId = await createUser(`Missing ${missing}`);
      const workspace = createWorkspaceMaintenanceService({ db: database.db, now: () => now });
      const directWrite = vi.fn(async () => []);
      const sync = vi.fn(async () => ({
        attempted: 0,
        failed: 0,
        recovered: 0,
        skipped: 0,
        succeeded: 0,
      }));
      const input = {
        ...requiredServices(),
        finances: operations({
          applyApprovedRules: directWrite,
          applyApprovedOneOffs: directWrite,
          syncDueAccountsForUser: sync,
        }),
        maintenance: workspace,
        now: () => now,
        status: { getFinanceStatus: async () => status() },
      };
      if (missing === "actions" || missing === "challenge" || missing === "periodReviews")
        Reflect.deleteProperty(input, missing);
      else Reflect.deleteProperty(input.finances, missing);
      const service = createFinanceMaintenanceService(input);
      const run = await service.startOrResume(ownerId, { type: "all_outstanding" });
      await expect(service.dispatchRun(run.id)).resolves.toMatchObject({
        status: "failed_terminal",
        lastSafeError: { code: "invalid_request" },
        settledResult: null,
      });
      expect(directWrite).not.toHaveBeenCalled();
      expect(sync).not.toHaveBeenCalled();
      expect(await workspace.listStepRecords(run.id)).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ status: "completed" })]),
      );
    }
  });

  it("runs health, verification and period review for questions without applying unresolved work", async () => {
    const ownerId = await createUser("Canonical questions");
    const workspace = createWorkspaceMaintenanceService({ db: database.db, now: () => now });
    const deps = requiredServices();
    const order: string[] = [];
    deps.challenge.resolve.mockResolvedValue({
      candidateId: crypto.randomUUID(),
      candidateRevision: `sha256:${"b".repeat(64)}`,
      questions: 2,
    });
    deps.periodReviews.createForRun.mockImplementation(async () => {
      order.push("period_review");
      return { id: crypto.randomUUID(), status: "completed_with_questions" };
    });
    const direct = vi.fn(async () => []);
    const service = createFinanceMaintenanceService({
      ...deps,
      finances: operations({
        applyApprovedRules: direct,
        applyApprovedOneOffs: direct,
        projectMaintenanceCandidateQuestionsForUser: async () => ({ created: 2, total: 2 }),
        proposeOutstandingCategorizations: async () => ({
          items: [
            proposal(crypto.randomUUID(), { confidence: 1 }),
            proposal(crypto.randomUUID(), { confidence: 0 }),
          ],
          nextCursor: null,
        }),
        refreshCashflowForUser: async () => {
          order.push("health");
          return { refreshed: true };
        },
        summarizeMaintenanceEffectsForRun: async () => ({
          categorizations: 0,
          transfers: 2,
          duplicateActions: 0,
          questions: 3,
          questionStepCreations: 0,
        }),
      }),
      maintenance: workspace,
      now: () => now,
      status: { getFinanceStatus: async () => status(undefined, { questions: 2 }) },
    });
    const run = await service.startOrResume(ownerId, { type: "all_outstanding" });
    await expect(service.dispatchRun(run.id)).resolves.toMatchObject({
      status: "awaiting_agent_challenge",
      settledResult: null,
    });
    expect(direct).not.toHaveBeenCalled();
    await resumeAfterChallenge(workspace, run.id);
    await expect(service.dispatchRun(run.id)).resolves.toMatchObject({
      status: "queued",
      checkpoint: { phase: "health_refresh" },
      settledResult: null,
    });
    await expect(service.dispatchRun(run.id)).resolves.toMatchObject({
      status: "completed_with_questions",
      settledResult: {
        questions: { created: 2, total: 2 },
        applied: { categorizations: 0, transfers: 2 },
        health: { applicability: "applied", refreshed: true },
        verification: { duplicateActions: 0, freshness: "current" },
      },
    });
    expect(order).toEqual(["health", "period_review"]);
    expect(deps.actions.settleFinanceMaintenanceCandidate).not.toHaveBeenCalled();
    expect(await workspace.listStepRecords(run.id)).toEqual(
      expect.arrayContaining(
        [
          "challenge_resolve",
          "commit_or_queue_review",
          "health_refresh",
          "verify",
          "period_review",
        ].map((step) => expect.objectContaining({ step, status: "completed" })),
      ),
    );
    await expect(service.dispatchRun(run.id)).resolves.toBeNull();
    expect(deps.periodReviews.createForRun).toHaveBeenCalledTimes(1);
  });

  it("rebuilds when projected questions were answered before recovery", async () => {
    const ownerId = await createUser("Answered projected questions");
    const workspace = createWorkspaceMaintenanceService({ db: database.db, now: () => now });
    const deps = requiredServices();
    deps.challenge.resolve.mockResolvedValue({
      candidateId: crypto.randomUUID(),
      candidateRevision: `sha256:${"e".repeat(64)}`,
      questions: 1,
    });
    const service = createFinanceMaintenanceService({
      ...deps,
      finances: operations({
        projectMaintenanceCandidateQuestionsForUser: async (input) => {
          await database.db
            .update(workspaceMaintenanceRuns)
            .set({
              checkpoint: {
                candidateId: input.candidateId,
                phase: "prepare",
                reason: "candidate_drift",
              },
              leaseClaimId: null,
              leaseExpiresAt: null,
              status: "queued",
            })
            .where(eq(workspaceMaintenanceRuns.id, input.runId));
          await database.db
            .delete(workspaceMaintenanceSteps)
            .where(eq(workspaceMaintenanceSteps.runId, input.runId));
          return { created: 0, rebuild: true, total: 0 };
        },
        proposeOutstandingCategorizations: async () => ({
          items: [proposal(crypto.randomUUID(), { confidence: 0 })],
          nextCursor: null,
        }),
      }),
      maintenance: workspace,
      now: () => now,
      status: { getFinanceStatus: async () => status() },
    });
    const run = await service.startOrResume(ownerId, { type: "all_outstanding" });
    await expect(service.dispatchRun(run.id)).resolves.toMatchObject({
      status: "awaiting_agent_challenge",
    });
    await resumeAfterChallenge(workspace, run.id);
    await expect(service.dispatchRun(run.id)).resolves.toMatchObject({
      checkpoint: { phase: "prepare" },
      status: "queued",
    });
    expect(await workspace.listStepRecords(run.id)).toEqual([]);
  });

  it("revalidates and rebuilds when a question is answered after projection", async () => {
    const ownerId = await createUser("Question answered after projection");
    const workspace = createWorkspaceMaintenanceService({ db: database.db, now: () => now });
    const deps = requiredServices();
    deps.challenge.resolve.mockResolvedValue({
      candidateId: crypto.randomUUID(),
      candidateRevision: `sha256:${"f".repeat(64)}`,
      questions: 1,
    });
    let outstandingQuestions = 1;
    const service = createFinanceMaintenanceService({
      ...deps,
      finances: operations({
        projectMaintenanceCandidateQuestionsForUser: async (input) => {
          if (outstandingQuestions > 0) return { created: 1, total: 1 };
          await database.db
            .update(workspaceMaintenanceRuns)
            .set({
              checkpoint: {
                candidateId: input.candidateId,
                phase: "prepare",
                reason: "candidate_drift",
              },
              leaseClaimId: null,
              leaseExpiresAt: null,
              status: "queued",
            })
            .where(eq(workspaceMaintenanceRuns.id, input.runId));
          await database.db
            .delete(workspaceMaintenanceSteps)
            .where(eq(workspaceMaintenanceSteps.runId, input.runId));
          return { created: 0, rebuild: true, total: 0 };
        },
        proposeOutstandingCategorizations: async () => ({
          items: [proposal(crypto.randomUUID(), { confidence: 0 })],
          nextCursor: null,
        }),
      }),
      maintenance: workspace,
      now: () => now,
      status: {
        getFinanceStatus: async () => status(undefined, { questions: outstandingQuestions }),
      },
    });
    const run = await service.startOrResume(ownerId, { type: "all_outstanding" });
    await service.dispatchRun(run.id);
    await resumeAfterChallenge(workspace, run.id);
    await expect(service.dispatchRun(run.id)).resolves.toMatchObject({
      checkpoint: { phase: "health_refresh" },
      status: "queued",
    });
    outstandingQuestions = 0;
    await expect(service.dispatchRun(run.id)).resolves.toMatchObject({
      checkpoint: { phase: "prepare" },
      settledResult: null,
      status: "queued",
    });
    expect(await workspace.listStepRecords(run.id)).toEqual([]);
  });

  it("persists a 50-item candidate cursor across runtimes before any semantic writes", async () => {
    const ownerId = await createUser("Canonical paging recovery");
    const workspace = createWorkspaceMaintenanceService({ db: database.db, now: () => now });
    const writes = vi.fn(async () => []);
    const pages = Array.from({ length: 51 }, () =>
      proposal(crypto.randomUUID(), { confidence: 1 }),
    );
    const finances = operations({
      applyApprovedRules: writes,
      applyApprovedOneOffs: writes,
      proposeOutstandingCategorizations: async (_userId, _scope, cursor) =>
        cursor
          ? { items: pages.slice(50), nextCursor: null }
          : { items: pages.slice(0, 50), nextCursor: "page-2" },
    });
    const append = vi.spyOn(finances, "appendMaintenanceCandidatePage");
    const input = {
      ...requiredServices(),
      finances,
      maintenance: workspace,
      now: () => now,
      status: { getFinanceStatus: async () => status() },
    };
    const first = createFinanceMaintenanceService(input);
    const run = await first.startOrResume(ownerId, { type: "all_outstanding" });
    await expect(first.dispatchRun(run.id)).resolves.toMatchObject({
      status: "queued",
      checkpoint: { phase: "prepare", cursor: "page-2", nextOrdinal: 50 },
    });
    const second = createFinanceMaintenanceService({
      ...input,
      maintenance: createWorkspaceMaintenanceService({ db: database.db, now: () => now }),
    });
    await expect(second.dispatchRun(run.id)).resolves.toMatchObject({
      status: "awaiting_agent_challenge",
    });
    expect(append.mock.calls.map(([page]) => page.items.length)).toEqual([50, 1]);
    expect(await workspace.listStepRecords(run.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          step: "prepare",
          result: expect.objectContaining({ prepared: 51, questions: 0 }),
        }),
      ]),
    );
    expect(writes).not.toHaveBeenCalled();
  });

  it("replays completed candidate preparation after process loss without duplicating prepared work", async () => {
    const ownerId = await createUser("Preparation checkpoint loss");
    const workspace = createWorkspaceMaintenanceService({ db: database.db, now: () => now });
    const finances = operations({
      proposeOutstandingCategorizations: async () => ({
        items: [proposal(crypto.randomUUID(), { confidence: 1 })],
        nextCursor: null,
      }),
    });
    const append = vi.spyOn(finances, "appendMaintenanceCandidatePage");
    const input = {
      ...requiredServices(),
      finances,
      maintenance: workspace,
      now: () => now,
      status: { getFinanceStatus: async () => status() },
    };
    let crash = true;
    const first = createFinanceMaintenanceService({
      ...input,
      maintenance: {
        ...workspace,
        completeStep: async (args) => {
          if (args.step === "prepare" && crash) {
            crash = false;
            throw new Error("process exited after candidate finalization");
          }
          return workspace.completeStep(args);
        },
      },
    });
    const run = await first.startOrResume(ownerId, { type: "all_outstanding" });
    await expect(first.dispatchRun(run.id)).resolves.toMatchObject({
      status: "failed_recoverable",
    });
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({ retryAt: sql`NOW() - INTERVAL '1 second'` })
      .where(eq(workspaceMaintenanceRuns.id, run.id));
    await expect(createFinanceMaintenanceService(input).dispatchRun(run.id)).resolves.toMatchObject(
      { status: "awaiting_agent_challenge" },
    );
    expect(append).toHaveBeenCalledTimes(1);
    expect(await workspace.listStepRecords(run.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          step: "prepare",
          result: expect.objectContaining({ prepared: 1 }),
        }),
      ]),
    );
  });

  it("routes reviewed candidate settlement through the required action authority with revision and tenant", async () => {
    const ownerId = await createUser("Canonical action authority");
    const workspace = createWorkspaceMaintenanceService({ db: database.db, now: () => now });
    const deps = requiredServices();
    const candidateId = crypto.randomUUID();
    const revision = `sha256:${"b".repeat(64)}`;
    deps.challenge.resolve.mockResolvedValue({
      candidateId,
      candidateRevision: revision,
      questions: 0,
    });
    const service = createFinanceMaintenanceService({
      ...deps,
      finances: operations(),
      maintenance: workspace,
      now: () => now,
      status: { getFinanceStatus: async () => status() },
    });
    const run = await service.startOrResume(ownerId, { type: "all_outstanding" });
    await service.dispatchRun(run.id);
    await expect(service.dispatchRun(run.id)).resolves.toBeNull();
    expect(deps.actions.settleFinanceMaintenanceCandidate).not.toHaveBeenCalled();
    deps.actions.settleFinanceMaintenanceCandidate.mockImplementation(async () => {
      await database.db
        .update(workspaceMaintenanceRuns)
        .set({ status: "queued", checkpoint: { candidateId, phase: "health_refresh" } })
        .where(eq(workspaceMaintenanceRuns.id, run.id));
      return { status: "committed" };
    });
    await resumeAfterChallenge(workspace, run.id);
    await service.dispatchRun(run.id);
    expect(deps.actions.settleFinanceMaintenanceCandidate).toHaveBeenCalledWith(
      candidateId,
      revision,
      expect.objectContaining({
        principal: expect.objectContaining({ userId: ownerId, actorType: "agent" }),
      }),
    );
    await expect(service.dispatchRun(run.id)).resolves.toMatchObject({
      status: "completed",
      settledResult: { verification: { freshness: "current", duplicateActions: 0 } },
    });
    expect(deps.periodReviews.createForRun).toHaveBeenCalledWith(ownerId, run.id);
    await expect(service.getRun(crypto.randomUUID(), run.id)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("retains claim exclusion and classifies challenge validation failures without successful settlement", async () => {
    for (const [code, expected] of [
      ["invalid_request", "failed_terminal"],
      ["forbidden", "failed_terminal"],
      ["conflict", "failed_recoverable"],
    ] as const) {
      const ownerId = await createUser(`Challenge ${code}`);
      const workspace = createWorkspaceMaintenanceService({ db: database.db, now: () => now });
      const deps = requiredServices();
      deps.challenge.resolve.mockRejectedValue(new AppError(code, "Challenge cannot resolve."));
      const service = createFinanceMaintenanceService({
        ...deps,
        finances: operations(),
        maintenance: workspace,
        now: () => now,
        status: { getFinanceStatus: async () => status() },
      });
      const run = await service.startOrResume(ownerId, { type: "all_outstanding" });
      const claim = await workspace.claim(run.id);
      expect(claim).not.toBeNull();
      await expect(service.dispatchRun(run.id)).resolves.toBeNull();
      await database.db
        .update(workspaceMaintenanceRuns)
        .set({ leaseExpiresAt: sql`NOW() - INTERVAL '1 second'` })
        .where(eq(workspaceMaintenanceRuns.id, run.id));
      await service.dispatchRun(run.id);
      await resumeAfterChallenge(workspace, run.id);
      await expect(service.dispatchRun(run.id)).resolves.toMatchObject({
        status: expected,
        settledResult: null,
      });
      expect(deps.actions.settleFinanceMaintenanceCandidate).not.toHaveBeenCalled();
    }
  });

  it("rechecks freshness and rulebook after verify process loss and reuses the period review", async () => {
    for (const mode of ["healthy", "state_changed", "stale", "blocked", "rulebook"] as const) {
      const ownerId = await createUser(`Verify recovery ${mode}`);
      const workspace = createWorkspaceMaintenanceService({ db: database.db, now: () => now });
      const deps = requiredServices();
      const health = vi.fn(async () => ({ refreshed: true }));
      let recovering = false;
      const reader = {
        getFinanceStatus: async () =>
          status(recovering && mode === "rulebook" ? `sha256:${"d".repeat(64)}` : undefined, {
            blocked: recovering && mode === "blocked",
            nonCurrent: recovering && mode === "stale",
            questions: 1,
            state: recovering && mode === "state_changed" ? "clean" : "needs_work",
          }),
      };
      const input = {
        ...deps,
        finances: operations({ refreshCashflowForUser: health }),
        maintenance: workspace,
        now: () => now,
        status: reader,
      };
      const first = createFinanceMaintenanceService({
        ...input,
        maintenance: {
          ...workspace,
          settle: async () => {
            throw new Error("process exited after review committed");
          },
        },
      });
      const run = await first.startOrResume(ownerId, { type: "all_outstanding" });
      await database.db
        .update(workspaceMaintenanceRuns)
        .set({ checkpoint: { phase: "health_refresh" } })
        .where(eq(workspaceMaintenanceRuns.id, run.id));
      await expect(first.dispatchRun(run.id)).rejects.toThrow(
        "process exited after review committed",
      );
      expect(deps.periodReviews.createForRun).toHaveBeenCalledTimes(1);
      recovering = true;
      await database.db
        .update(workspaceMaintenanceRuns)
        .set({
          leaseExpiresAt: sql`NOW() - INTERVAL '1 second'`,
        })
        .where(eq(workspaceMaintenanceRuns.id, run.id));
      const recovered = createFinanceMaintenanceService(input);
      await expect(recovered.dispatchRun(run.id)).resolves.toMatchObject({
        status:
          mode === "healthy" || mode === "state_changed"
            ? "completed_with_questions"
            : mode === "blocked"
              ? "blocked"
              : mode === "rulebook"
                ? "failed_terminal"
                : "failed_recoverable",
      });
      if (mode === "stale") {
        await expect(recovered.getRun(ownerId, run.id)).resolves.toMatchObject({
          lastSafeError: { code: "finance_source_not_current" },
        });
        expect(await workspace.listStepRecords(run.id)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ step: "verify", status: "completed" }),
          ]),
        );
      }
      expect(health).toHaveBeenCalledTimes(1);
      expect(deps.periodReviews.createForRun).toHaveBeenCalledTimes(1);
    }
  });

  it("never claims completion when immutable period review persistence fails", async () => {
    const ownerId = await createUser("Required immutable period review");
    const workspace = createWorkspaceMaintenanceService({ db: database.db, now: () => now });
    const deps = requiredServices();
    deps.periodReviews.createForRun.mockRejectedValue(new Error("review storage offline"));
    const service = createFinanceMaintenanceService({
      ...deps,
      finances: operations(),
      maintenance: workspace,
      now: () => now,
      status: { getFinanceStatus: async () => status() },
    });
    const run = await service.startOrResume(ownerId, { type: "all_outstanding" });
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({ checkpoint: { phase: "health_refresh" } })
      .where(eq(workspaceMaintenanceRuns.id, run.id));
    await expect(service.dispatchRun(run.id)).resolves.toMatchObject({
      status: "failed_recoverable",
      settledResult: null,
    });
    expect(await workspace.listStepRecords(run.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ step: "verify", status: "completed" }),
        expect.objectContaining({ step: "period_review", status: "failed_recoverable" }),
      ]),
    );
  });

  it("forwards window and target scopes through candidate discovery, exact reconciliation and health", async () => {
    for (const scope of [
      { type: "window", start: "2026-08-01", end: "2026-08-07" },
      { type: "target", entityType: "finance_transaction", id: crypto.randomUUID() },
    ] as const) {
      const ownerId = await createUser(`Canonical ${scope.type} scope`);
      const workspace = createWorkspaceMaintenanceService({ db: database.db, now: () => now });
      const observed: MaintenanceScope[] = [];
      const deps = requiredServices();
      deps.challenge.resolve.mockResolvedValue({
        candidateId: crypto.randomUUID(),
        candidateRevision: `sha256:${"a".repeat(64)}`,
        questions: 1,
      });
      const service = createFinanceMaintenanceService({
        ...deps,
        finances: operations({
          projectMaintenanceCandidateQuestionsForUser: async () => ({ created: 1, total: 1 }),
          syncDueAccountsForUser: async (_userId, scope) => {
            observed.push(scope);
            return { attempted: 0, failed: 0, recovered: 0, skipped: 0, succeeded: 0 };
          },
          reconcileExactTransfersForUser: async (_userId, scope) => {
            observed.push(scope);
            return { paired: 0, transfers: 0 };
          },
          proposeOutstandingCategorizations: async (_userId, scope) => {
            observed.push(scope);
            return { items: [], nextCursor: null };
          },
          refreshCashflowForUser: async (_userId, scope) => {
            observed.push(scope);
            return { refreshed: false };
          },
        }),
        maintenance: workspace,
        now: () => now,
        status: { getFinanceStatus: async () => status(undefined, { questions: 1 }) },
      });
      const run = await service.startOrResume(ownerId, scope);
      await service.dispatchRun(run.id);
      await resumeAfterChallenge(workspace, run.id);
      await service.dispatchRun(run.id);
      await expect(service.dispatchRun(run.id)).resolves.toMatchObject({
        scope,
        status: "completed_with_questions",
        settledResult: {
          health: { applicability: "skipped_scoped", confidence: "reliable", refreshed: false },
        },
      });
      expect(observed).toEqual([scope, scope, scope, scope]);
    }
  });
});
