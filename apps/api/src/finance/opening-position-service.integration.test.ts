import { resolve } from "node:path";
import {
  createDatabaseClient,
  financeAccounts,
  financeEconomicEvents,
  financeTransactionCoverage,
  financeTransactionRelationships,
  financeTransactions,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import type { Principal } from "../types.js";
import { createFinanceAttentionService } from "./attention-service.js";
import { createFinanceOpeningPositionService } from "./opening-position-service.js";

describe.sequential("Finance opening statements", () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabaseClient>;
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve("packages/database/migrations"));
  }, 120_000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });
  async function fixture() {
    const [owner] = await database.db
      .insert(users)
      .values({
        displayName: "Opening fixture",
        email: `${crypto.randomUUID()}@example.com`,
        passwordHash: "unused",
      })
      .returning();
    if (!owner) throw new Error("Missing owner");
    const [account] = await database.db
      .insert(financeAccounts)
      .values({
        userId: owner.id,
        institution: "Synthetic",
        name: "Cash",
        provider: "manual",
        status: "manual",
        currencyCode: "USD",
        ownershipType: "individual",
        ownershipShareBps: 10000,
      })
      .returning();
    if (!account) throw new Error("Missing account");
    const principal: Principal = {
      actorType: "user",
      actorId: owner.id,
      userId: owner.id,
      scopes: new Set(["finances:read", "finances:write"]),
    };
    return { context: { principal, requestId: crypto.randomUUID() }, account };
  }
  const service = () =>
    createFinanceOpeningPositionService({
      db: database.db,
      now: () => new Date("2026-11-12T16:00:00Z"),
    });
  it("requires explicit opening evidence instead of assuming today's account balance", async () => {
    const f = await fixture();
    expect(
      await service().readOpeningPosition(f.context.principal.userId, "2026-11"),
    ).toMatchObject({
      qualified: false,
      accounts: [
        {
          accountId: f.account.id,
          name: "Cash",
          accountRevision: f.account.contextualRevision.toString(),
          currencyCode: "USD",
        },
      ],
    });
    const input = {
      accountId: f.account.id,
      month: "2026-11",
      expectedAccountRevision: f.account.contextualRevision.toString(),
      expectedStatementRevision: 0,
      signedOpeningBalanceCents: 125000,
      idempotencyKey: crypto.randomUUID(),
    };
    const statement = await service().confirmOpeningStatement(f.context, input);
    expect(statement).toMatchObject({ signedOpeningBalanceCents: 125000, revision: 1 });
    expect(await service().confirmOpeningStatement(f.context, input)).toEqual(statement);
    expect(
      await service().readOpeningPosition(f.context.principal.userId, "2026-11"),
    ).toMatchObject({ qualified: true, accounts: [{ openingBalanceCents: 125000 }] });
    expect(
      await service().readOpeningPosition(f.context.principal.userId, "2026-12"),
    ).toMatchObject({ qualified: false });
    await database.db
      .update(financeAccounts)
      .set({ balance: 140000, name: "Renamed cash" })
      .where(eq(financeAccounts.id, f.account.id));
    expect(
      await service().readOpeningPosition(f.context.principal.userId, "2026-11"),
    ).toMatchObject({ qualified: true });
    await database.db
      .update(financeAccounts)
      .set({ currencyCode: "EUR" })
      .where(eq(financeAccounts.id, f.account.id));
    expect(
      await service().readOpeningPosition(f.context.principal.userId, "2026-11"),
    ).toMatchObject({ qualified: false });
  });
  it("separates old cleanup only after explicit start approval and qualified opening evidence", async () => {
    const f = await fixture();
    await database.db.insert(financeTransactions).values({
      userId: f.context.principal.userId,
      accountId: f.account.id,
      merchant: "Historical fixture",
      amount: 1000,
      direction: "expense",
      transactionDate: "2026-10-20",
      needsReview: true,
    });
    const attention = createFinanceAttentionService({
      db: database.db,
      now: () => new Date("2026-11-12T16:00:00Z"),
    });
    const preview = await attention.previewBudgetStart(f.context, {
      firstMonth: "2026-11",
      expectedPolicyRevision: 0,
      idempotencyKey: crypto.randomUUID(),
    });
    await attention.applyBudgetStart(f.context, {
      previewId: preview.id,
      fingerprint: preview.fingerprint,
    });
    await service().confirmOpeningStatement(f.context, {
      accountId: f.account.id,
      month: "2026-11",
      expectedAccountRevision: f.account.contextualRevision.toString(),
      expectedStatementRevision: 0,
      signedOpeningBalanceCents: 125000,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(await attention.getAttentionSnapshot(f.context.principal.userId)).toMatchObject({
      historicalRecordCount: 1,
      activeTransactionCount: 0,
      budgetReady: false,
      readiness: { openingPositionQualified: true, budgetApproved: false },
    });
    const historical = await database.db.query.financeTransactions.findFirst({
      where: eq(financeTransactions.accountId, f.account.id),
    });
    const [current] = await database.db
      .insert(financeTransactions)
      .values({
        userId: f.context.principal.userId,
        accountId: f.account.id,
        merchant: "Current refund fixture",
        amount: 1000,
        direction: "income",
        transactionDate: "2026-11-03",
        needsReview: false,
      })
      .returning();
    const [event] = await database.db
      .insert(financeEconomicEvents)
      .values({
        userId: f.context.principal.userId,
        kind: "refund",
        stableKey: crypto.randomUUID(),
      })
      .returning();
    if (!historical || !current || !event) throw new Error("Missing relationship fixture");
    await database.db.insert(financeTransactionRelationships).values({
      userId: f.context.principal.userId,
      economicEventId: event.id,
      relationship: "refund",
      transactionIds: [historical.id, current.id],
      rationale: "Synthetic current-period dependency",
      provenance: {},
    });
    expect(await attention.getAttentionSnapshot(f.context.principal.userId)).toMatchObject({
      historicalRecordCount: 0,
      activeTransactionCount: 1,
      dependencyRefs: [`flag:${historical.id}`],
    });
  });
  it("previews historical separation without presenting it as already applied", async () => {
    const f = await fixture();
    await database.db.insert(financeTransactions).values({
      userId: f.context.principal.userId,
      accountId: f.account.id,
      merchant: "Old fixture",
      amount: 1000,
      direction: "expense",
      transactionDate: "2026-10-20",
      needsReview: true,
    });
    await service().confirmOpeningStatement(f.context, {
      accountId: f.account.id,
      month: "2026-11",
      expectedAccountRevision: f.account.contextualRevision.toString(),
      expectedStatementRevision: 0,
      signedOpeningBalanceCents: 125000,
      idempotencyKey: crypto.randomUUID(),
    });
    const attention = createFinanceAttentionService({
      db: database.db,
      now: () => new Date("2026-11-12T16:00:00Z"),
    });
    const preview = await attention.previewBudgetStart(f.context, {
      firstMonth: "2026-11",
      expectedPolicyRevision: 0,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(preview.attention).toMatchObject({
      historicalRecordCount: 0,
      activeTransactionCount: 1,
    });
    expect(preview.projectedAttention).toMatchObject({
      historicalRecordCount: 1,
      activeTransactionCount: 0,
    });
    expect(await attention.getBudgetStart(f.context.principal.userId)).toBeNull();
  });
  it("carries cash into the next month only with complete movement evidence and coverage", async () => {
    const f = await fixture();
    await service().confirmOpeningStatement(f.context, {
      accountId: f.account.id,
      month: "2026-11",
      expectedAccountRevision: f.account.contextualRevision.toString(),
      expectedStatementRevision: 0,
      signedOpeningBalanceCents: 125000,
      idempotencyKey: crypto.randomUUID(),
    });
    const owner = await database.db.query.users.findFirst({
      where: eq(users.id, f.context.principal.userId),
    });
    if (!owner) throw new Error("Missing owner");
    const december = createFinanceOpeningPositionService({
      db: database.db,
      now: () => new Date("2026-12-02T16:00:00Z"),
    });
    const [movement] = await database.db
      .insert(financeTransactions)
      .values({
        userId: owner.id,
        accountId: f.account.id,
        merchant: "Synthetic transfer",
        amount: 2500,
        direction: "transfer",
        transactionDate: "2026-11-20",
        currencyCode: "USD",
        providerDirection: "expense",
      })
      .returning();
    expect((await december.readOpeningPosition(owner.id, "2026-12")).qualified).toBe(false);
    if (!owner) throw new Error("Missing owner");
    await database.db.insert(financeTransactionCoverage).values({
      userId: owner.id,
      accountId: f.account.id,
      fromDate: "2026-11-01",
      throughDate: "2026-11-30",
      timezone: owner.planningTimezone,
      currencyCode: "USD",
      evidenceRef: "synthetic-full-statement",
      recordedAt: new Date("2026-12-01T16:00:00Z"),
    });
    expect(await december.readOpeningPosition(owner.id, "2026-12")).toMatchObject({
      qualified: true,
      accounts: [{ openingBalanceCents: 122500 }],
    });
    if (!movement) throw new Error("Missing movement");
    await database.db
      .update(financeTransactions)
      .set({ providerDirection: null })
      .where(eq(financeTransactions.id, movement.id));
    expect(await december.readOpeningPosition(owner.id, "2026-12")).toMatchObject({
      qualified: false,
      reasons: expect.arrayContaining(["movement_evidence_missing"]),
    });
  });
  it("does not accept an agent assertion as a personal statement or cross-owner account", async () => {
    const f = await fixture();
    const other = await fixture();
    const input = {
      accountId: f.account.id,
      month: "2026-11",
      expectedAccountRevision: f.account.contextualRevision.toString(),
      expectedStatementRevision: 0,
      signedOpeningBalanceCents: 125000,
      idempotencyKey: crypto.randomUUID(),
    };
    await expect(
      service().confirmOpeningStatement(
        {
          ...f.context,
          principal: { ...f.context.principal, actorType: "agent", actorId: crypto.randomUUID() },
        },
        input,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(service().confirmOpeningStatement(other.context, input)).rejects.toMatchObject({
      code: "not_found",
    });
  });
});
