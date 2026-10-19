import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  auditEvents,
  createDatabaseClient,
  type DatabaseClient,
  financeAccounts,
  financeGoals,
  financePlanningEvidence,
  financeRecurringObligations,
  financeTransactions,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { financePlanningEvidenceApplicability } from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq } from "drizzle-orm";
import { createFinanceService } from "../finance-service.js";
import type { FinanceMutationContext } from "./context.js";
import { createFinancePlanningEvidenceService } from "./planning-evidence-service.js";

describe.sequential("canonical explicit user planning evidence", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  const now = () => new Date("2026-03-09T00:15:00Z");
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120_000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });

  async function fixture() {
    const [owner] = await database.db
      .insert(users)
      .values({
        email: `planning-${randomUUID()}@nohmi.test`,
        displayName: "Synthetic planning",
        passwordHash: "unused",
        planningTimezone: "America/New_York",
      })
      .returning();
    if (!owner) throw new Error("Fixture owner missing");
    const [account] = await database.db
      .insert(financeAccounts)
      .values({
        userId: owner.id,
        name: "Synthetic EUR",
        institution: "Local fixture",
        provider: "manual",
        currencyCode: "EUR",
      })
      .returning();
    if (!account) throw new Error("Fixture account missing");
    const [obligation] = await database.db
      .insert(financeRecurringObligations)
      .values({
        userId: owner.id,
        accountId: account.id,
        merchant: "qa monthly bill",
        displayName: "Synthetic monthly bill",
        kind: "bill",
        cadence: "monthly",
        expectedAmount: 10000,
        amountTolerance: 800,
        confidence: 8200,
        source: "inferred",
        status: "needs_review",
      })
      .returning();
    const [goal] = await database.db
      .insert(financeGoals)
      .values({ userId: owner.id, name: "Synthetic goal", targetAmount: 50000 })
      .returning();
    if (!obligation || !goal) throw new Error("Fixture sources missing");
    const context: FinanceMutationContext = {
      userId: owner.id,
      actorId: owner.id,
      actorType: "user",
      canMutate: true,
      canSelfApprove: false,
      bypassEnabled: false,
      requestId: randomUUID(),
    };
    const service = createFinanceService({ db: database.db, now });
    const cost = {
      operation: "confirm_cost" as const,
      itemType: "obligation" as const,
      itemId: obligation.id,
      expectedRevision: obligation.revision,
      expectedAmountCents: 10000,
      cadence: "monthly" as const,
      accountId: account.id,
      currencyCode: "EUR",
      fixedness: "fixed" as const,
      asOf: "2026-03-08",
      idempotencyKey: randomUUID(),
    };
    const progress = {
      operation: "confirm_progress" as const,
      goalId: goal.id,
      expectedVersion: goal.version,
      progressAmountCents: 0,
      currencyCode: "EUR",
      asOf: "2026-03-08",
      idempotencyKey: randomUUID(),
    };
    return { owner, account, obligation, goal, context, service, cost, progress };
  }

  it("returns current DTO evidence, preserves unknown legacy zero and replays one atomic receipt", async () => {
    const f = await fixture();
    expect((await f.service.listFinanceGoals(f.owner.id)).data[0]?.planningEvidence).toBeNull();
    const first = await f.service.manageFinanceGoal(f.progress, f.context);
    const replay = await f.service.manageFinanceGoal(f.progress, f.context);
    expect(replay).toEqual(first);
    expect(first.data).toMatchObject({
      currentAmount: 0,
      version: 2,
      planningEvidence: {
        kind: "goal",
        goalVersion: 2,
        progressAmountCents: 0,
        currencyCode: "EUR",
      },
    });
    const cost = await f.service.manageFinanceRecurringItem(f.cost, f.context);
    expect(cost.data).toMatchObject({
      revision: 2,
      planningEvidence: { sourceRevision: 2, expectedAmountCents: 10000 },
    });
    const listed = await f.service.listFinanceRecurringItems(f.owner.id);
    expect(listed.data.obligations[0]?.planningEvidence).toEqual(
      "planningEvidence" in cost.data ? cost.data.planningEvidence : null,
    );
    expect(
      await database.db
        .select()
        .from(financePlanningEvidence)
        .where(eq(financePlanningEvidence.userId, f.owner.id)),
    ).toHaveLength(2);
    expect(
      await database.db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.userId, f.owner.id),
            eq(auditEvents.action, "finance.planning_evidence.confirmed"),
          ),
        ),
    ).toHaveLength(2);
    await expect(
      f.service.manageFinanceGoal({ ...f.progress, progressAmountCents: 5 }, f.context),
    ).rejects.toMatchObject({
      code: "invalid_request",
      message: "That idempotency key was already used for different Finance work.",
    });
  });

  it("forbids agent replay of a completed human receipt with identical owner/key/payload", async () => {
    const f = await fixture();
    await f.service.manageFinanceGoal(f.progress, f.context);
    await f.service.manageFinanceRecurringItem(f.cost, f.context);
    const agent = { ...f.context, actorType: "agent" as const, actorId: "synthetic-agent" };
    await expect(f.service.manageFinanceGoal(f.progress, agent)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(f.service.manageFinanceRecurringItem(f.cost, agent)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(
      await database.db
        .select()
        .from(financePlanningEvidence)
        .where(eq(financePlanningEvidence.userId, f.owner.id)),
    ).toHaveLength(2);
  });

  it("rolls back source CAS, evidence and audit together when the supplied transaction fails", async () => {
    const f = await fixture();
    const helper = createFinancePlanningEvidenceService({ db: database.db, now });
    await expect(
      database.db.transaction(async (tx) => {
        await helper.confirmGoal({
          tx,
          context: f.context,
          input: {
            goalId: f.goal.id,
            expectedVersion: 1,
            progressAmountCents: 123,
            currencyCode: "EUR",
            asOf: "2026-03-08",
          },
        });
        throw new Error("forced caller rollback");
      }),
    ).rejects.toThrow("forced caller rollback");
    const saved = await database.db.query.financeGoals.findFirst({
      where: eq(financeGoals.id, f.goal.id),
    });
    expect(saved).toMatchObject({ version: 1, currentAmount: 0 });
    expect(
      await database.db
        .select()
        .from(financePlanningEvidence)
        .where(eq(financePlanningEvidence.userId, f.owner.id)),
    ).toHaveLength(0);
    expect(
      await database.db.select().from(auditEvents).where(eq(auditEvents.userId, f.owner.id)),
    ).toHaveLength(0);
  });

  it("rejects cross-owner and agent evidence without source effects", async () => {
    const f = await fixture();
    const other = await fixture();
    await expect(f.service.manageFinanceGoal(f.progress, other.context)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      f.service.manageFinanceRecurringItem(f.cost, {
        ...f.context,
        actorType: "agent",
        actorId: "synthetic-agent",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      await database.db
        .select()
        .from(financePlanningEvidence)
        .where(eq(financePlanningEvidence.userId, f.owner.id)),
    ).toHaveLength(0);
    expect(await f.service.listFinanceGoals(other.owner.id)).not.toMatchObject({
      data: [{ id: f.goal.id }],
    });
  });

  it("serializes competing goal statements and exposes only latest evidence per requested source", async () => {
    const f = await fixture();
    const outcomes = await Promise.allSettled([
      f.service.manageFinanceGoal(f.progress, f.context),
      f.service.manageFinanceGoal(
        { ...f.progress, idempotencyKey: randomUUID(), progressAmountCents: 10 },
        f.context,
      ),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    await f.service.manageFinanceGoal(
      { ...f.progress, expectedVersion: 2, progressAmountCents: 20, idempotencyKey: randomUUID() },
      f.context,
    );
    const latest = await createFinancePlanningEvidenceService({
      db: database.db,
      now,
    }).listLatestEvidence(f.owner.id, { goalIds: [f.goal.id], obligationIds: [] });
    expect(latest).toHaveLength(1);
    expect(latest[0]).toMatchObject({ goalVersion: 3, progressAmountCents: 20 });
    expect((await f.service.listFinanceGoals(f.owner.id)).data[0]?.planningEvidence).toEqual(
      latest[0],
    );
  });

  it("does not revive original evidence after inferred amount A to B to A refresh", async () => {
    const f = await fixture();
    const confirmed = await f.service.manageFinanceRecurringItem(f.cost, f.context);
    const evidence = "planningEvidence" in confirmed.data ? confirmed.data.planningEvidence : null;
    await database.db.insert(financeTransactions).values(
      ["2025-12-01", "2026-01-01", "2026-02-01", "2026-03-01"].map((transactionDate) => ({
        userId: f.owner.id,
        accountId: f.account.id,
        merchant: "QA Monthly Bill",
        amount: 12000,
        direction: "expense" as const,
        transactionDate,
      })),
    );
    await f.service.refreshCashflowInsights(f.owner.id);
    await database.db
      .update(financeTransactions)
      .set({ amount: 10000 })
      .where(eq(financeTransactions.userId, f.owner.id));
    await f.service.refreshCashflowInsights(f.owner.id);
    const current = (await f.service.listFinanceRecurringItems(f.owner.id)).data.obligations[0];
    expect(current).toMatchObject({ expectedAmount: 100, planningEvidence: evidence });
    expect(current?.revision).toBeGreaterThan(
      ("revision" in confirmed.data ? confirmed.data.revision : 0) ?? 0,
    );
    expect(
      financePlanningEvidenceApplicability({
        ownerUserId: f.owner.id,
        today: "2026-03-08",
        evidence,
        source: {
          kind: "obligation",
          id: f.obligation.id,
          ownerUserId: f.owner.id,
          revision: current?.revision ?? 0,
          expectedAmountCents: 10000,
          cadence: "monthly",
          accountId: f.account.id,
          currencyCode: "EUR",
          obligationKind: "bill",
          status: "needs_review",
        },
      }),
    ).toEqual({ state: "unknown", reason: "source_changed" });
  });

  it("retains account binding after FK deletion and rejects future/currency-invalid statements", async () => {
    const f = await fixture();
    await expect(
      f.service.manageFinanceGoal({ ...f.progress, asOf: "2026-03-09" }, f.context),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      f.service.manageFinanceRecurringItem(
        { ...f.cost, idempotencyKey: randomUUID(), currencyCode: "USD" },
        f.context,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await f.service.manageFinanceRecurringItem(
      { ...f.cost, idempotencyKey: randomUUID() },
      f.context,
    );
    await database.db.delete(financeAccounts).where(eq(financeAccounts.id, f.account.id));
    const current = (await f.service.listFinanceRecurringItems(f.owner.id)).data.obligations[0];
    expect(current?.accountId).toBeNull();
    expect(current?.planningEvidence?.accountId).toBe(f.account.id);
  });
});
