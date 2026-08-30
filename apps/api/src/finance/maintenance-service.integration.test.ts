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
});
