import { resolve } from "node:path";
import {
  createDatabaseClient,
  financeLedgerChallenges,
  financeMaintenanceCandidateItems,
  financeMaintenanceCandidates,
  financePeriodReviews,
  migrateDatabase,
  users,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import { type FinanceStatus, financeLedgerChallengeChecks } from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { createFinancePeriodReviewService } from "./finance-period-review-service.js";

const now = new Date("2026-08-21T12:00:00.000Z");

describe.sequential("Finance period review service", () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabaseClient>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine")
      .withDatabase("personal_os")
      .withUsername("personal_os")
      .withPassword("personal_os")
      .start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120_000);

  afterAll(async () => {
    await database.close();
    await container.stop();
  });

  it("publishes one reproducible review from a committed challenged candidate", async () => {
    const [owner] = await database.db
      .insert(users)
      .values({
        displayName: "Period review owner",
        email: `period-review-${crypto.randomUUID()}@example.com`,
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!owner) throw new Error("Period review owner was not created.");
    const rulebookVersion = `sha256:${"a".repeat(64)}`;
    const [run] = await database.db
      .insert(workspaceMaintenanceRuns)
      .values({
        domain: "finances",
        rulebookVersion,
        scope: { end: "2026-08-31", start: "2026-08-01", type: "window" },
        status: "queued",
        userId: owner.id,
      })
      .returning();
    if (!run) throw new Error("Period review run was not created.");
    const [candidate] = await database.db
      .insert(financeMaintenanceCandidates)
      .values({
        projection: {
          budgetActual: 200,
          budgetTotal: 250,
          budgetVariance: -50,
          grossCashSpending: 310,
          matchedReimbursementIncome: 220,
          monthlyCapacity: 1_000,
          personalSpending: 90,
          plannedIncome: 2_000,
          profileExpectedNetIncome: 2_000,
          questions: 0,
          recurringCommittedOutflow: 1_000,
          reimbursementsOutstanding: 0,
          workItems: 1,
        },
        revision: `sha256:${"b".repeat(64)}`,
        runId: run.id,
        state: "committed",
        userId: owner.id,
      })
      .returning();
    if (!candidate) throw new Error("Period review candidate was not created.");
    const [item] = await database.db
      .insert(financeMaintenanceCandidateItems)
      .values({
        actionKind: "alert",
        candidateId: candidate.id,
        disposition: "committed",
        evidence: {},
        fingerprint: `sha256:${"c".repeat(64)}`,
        ordinal: 0,
        privatePayload: { actionKind: "alert", input: { operation: "refresh" } },
      })
      .returning();
    if (!item) throw new Error("Period review item was not created.");
    await database.db.insert(financeLedgerChallenges).values({
      candidateId: candidate.id,
      candidateRevision: candidate.revision,
      coverage: { checked: financeLedgerChallengeChecks, reviewedItemIds: [item.id] },
      cutoff: now,
      rubricVersion: "finance-ledger-challenge-v1",
      runId: run.id,
      state: "resolved",
      submittedAt: now,
      submittingAgentId: "connected-agent",
      userId: owner.id,
    });
    const observed = {
      asOf: now.toISOString(),
      details: {
        activeGoals: [],
        cashFlow: { net: 500, projectedLowestBalance: 1_250 },
        closeReadiness: {
          missingProvenance: 0,
          possibleDuplicates: 0,
          ready: true,
          reconciledThrough: "2026-08-21",
          unansweredExceptions: 0,
          uncategorized: 0,
          unmatchedTransfers: 0,
        },
        evidence: { cutoff: now.toISOString(), current: true },
        income: { monthly: 2_000 },
        reimbursements: {
          anomalies: 0,
          expected: 0,
          needsInput: 0,
          open: 0,
          overdue: 0,
          outstanding: 0,
          received: 1,
          unresolved: 0,
          unmatchedCredits: 0,
        },
        questions: [],
        rulebookVersion,
        wealth: { cash: 3_000, debt: 0, netWorth: 3_000 },
      },
      freshness: { blockers: [], state: "current" },
    } as unknown as FinanceStatus;
    let snapshotExecutor: unknown;
    let statusReads = 0;
    let markBothSnapshotsRead!: () => void;
    let releaseSnapshots!: () => void;
    const bothSnapshotsRead = new Promise<void>((resolve) => {
      markBothSnapshotsRead = resolve;
    });
    const snapshotsReleased = new Promise<void>((resolve) => {
      releaseSnapshots = resolve;
    });
    const service = createFinancePeriodReviewService({
      db: database.db,
      now: () => now,
      status: {
        getFinanceStatus: async (_userId, _scope, executor) => {
          snapshotExecutor = executor;
          statusReads += 1;
          if (statusReads <= 2) {
            if (statusReads === 2) markBothSnapshotsRead();
            await snapshotsReleased;
          }
          return observed;
        },
      },
    });
    const concurrent = Promise.all([
      service.createForRun(owner.id, run.id),
      service.createForRun(owner.id, run.id),
    ]);
    await bothSnapshotsRead;
    releaseSnapshots();
    const [first, concurrentReplay] = await concurrent;
    expect(snapshotExecutor).toBeDefined();
    expect(concurrentReplay).toEqual(first);
    const replay = await service.createForRun(owner.id, run.id);
    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      challenge: { checked: financeLedgerChallengeChecks, findings: 0 },
      period: { end: "2026-08-31", start: "2026-08-01" },
      position: { closing: 3_000, opening: 2_500 },
      spending: { budgetVariance: -50, gross: 310, personal: 90, savings: 1_910 },
      status: "completed",
      work: { questions: 0, rulesAndActions: 1 },
    });
    await expect(service.getOwned(owner.id, first.id)).resolves.toEqual(first);
    await expect(service.getLatest(owner.id)).resolves.toEqual(first);
    await expect(
      database.db
        .select({ id: financePeriodReviews.id })
        .from(financePeriodReviews)
        .where(eq(financePeriodReviews.runId, run.id)),
    ).resolves.toHaveLength(1);
  });

  it("keeps missing, stale, and incomplete close packets unpublished", async () => {
    const [owner] = await database.db
      .insert(users)
      .values({
        displayName: "Incomplete period owner",
        email: `incomplete-period-${crypto.randomUUID()}@example.com`,
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!owner) throw new Error("Incomplete period owner was not created.");
    const rulebookVersion = `sha256:${"d".repeat(64)}`;
    const observed = {
      asOf: now.toISOString(),
      details: {
        activeGoals: [],
        cashFlow: { net: null, projectedLowestBalance: null },
        closeReadiness: {
          missingProvenance: 1,
          possibleDuplicates: 0,
          ready: false,
          reconciledThrough: null,
          unansweredExceptions: 1,
          uncategorized: 1,
          unmatchedTransfers: 0,
        },
        evidence: { cutoff: null, current: true },
        income: { monthly: null },
        questions: [],
        reimbursements: {
          anomalies: 0,
          expected: 0,
          needsInput: 0,
          open: 0,
          overdue: 0,
          outstanding: 0,
          received: 0,
          unresolved: 0,
          unmatchedCredits: 0,
        },
        rulebookVersion,
        wealth: { cash: null, debt: null, netWorth: null },
      },
      freshness: { blockers: [], state: "current" },
    } as unknown as FinanceStatus;
    const service = createFinancePeriodReviewService({
      db: database.db,
      now: () => now,
      status: { getFinanceStatus: async () => observed },
    });
    await expect(service.getLatest(owner.id)).resolves.toBeNull();
    await expect(service.getOwned(owner.id, crypto.randomUUID())).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(service.createForRun(owner.id, crypto.randomUUID())).rejects.toMatchObject({
      code: "not_found",
    });

    const [run] = await database.db
      .insert(workspaceMaintenanceRuns)
      .values({
        domain: "finances",
        rulebookVersion,
        scope: { entityType: "finance_account", id: crypto.randomUUID(), type: "target" },
        status: "queued",
        userId: owner.id,
      })
      .returning();
    if (!run) throw new Error("Incomplete period run was not created.");
    await expect(service.createForRun(owner.id, run.id)).rejects.toMatchObject({
      code: "conflict",
    });

    const [candidate] = await database.db
      .insert(financeMaintenanceCandidates)
      .values({
        projection: {
          budgetActual: 0,
          budgetTotal: 0,
          budgetVariance: 0,
          grossCashSpending: 0,
          matchedReimbursementIncome: 0,
          monthlyCapacity: null,
          personalSpending: 0,
          plannedIncome: 0,
          profileExpectedNetIncome: null,
          questions: 0,
          recurringCommittedOutflow: 0,
          reimbursementsOutstanding: 0,
          workItems: 0,
        },
        revision: `sha256:${"e".repeat(64)}`,
        runId: run.id,
        state: "committed",
        userId: owner.id,
      })
      .returning();
    if (!candidate) throw new Error("Incomplete period candidate was not created.");
    await expect(service.createForRun(owner.id, run.id)).rejects.toMatchObject({
      code: "conflict",
    });

    const staleService = createFinancePeriodReviewService({
      db: database.db,
      now: () => now,
      status: {
        getFinanceStatus: async () => ({
          ...observed,
          freshness: {
            blockers: [
              {
                code: "provider_sync",
                message: "Provider synchronization is stale.",
                recovery: null,
              },
            ],
            observedAt: now.toISOString(),
            state: "stale",
          },
        }),
      },
    });
    await expect(staleService.createForRun(owner.id, run.id)).rejects.toMatchObject({
      code: "conflict",
    });
  });
});
