import { resolve } from "node:path";
import {
  createDatabaseClient,
  financeAccounts,
  financeConversationMessages,
  financeOpeningStatements,
  financeReviewBatchApprovals,
  financeReviewBatchCorrections,
  financeReviewBatchEffects,
  financeReviewBatchRuns,
  financeTransactions,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import type { Principal } from "../types.js";
import { createFinanceAttentionService } from "./attention-service.js";

describe.sequential("Finance budget starting policy", () => {
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
        displayName: "Finance owner",
        email: `${crypto.randomUUID()}@example.com`,
        passwordHash: "unused",
        planningTimezone: "America/New_York",
      })
      .returning();
    if (!owner) throw new Error("Missing fixture");
    const principal: Principal = {
      actorType: "user",
      actorId: owner.id,
      userId: owner.id,
      scopes: new Set(["finances:read", "finances:write"]),
    };
    return { principal, requestId: crypto.randomUUID() };
  }
  const service = () =>
    createFinanceAttentionService({ db: database.db, now: () => new Date("2026-11-12T16:00:00Z") });
  const input = () => ({
    firstMonth: "2026-11",
    expectedPolicyRevision: 0,
    idempotencyKey: crypto.randomUUID(),
  });
  it("does not claim budget readiness or suppress historical work before qualification", async () => {
    const owner = await fixture();
    const output = await service().getAttentionSnapshot(owner.principal.userId);
    expect(output).toMatchObject({
      complete: true,
      period: "2026-11",
      activeDecisionCount: 0,
      budgetReady: false,
    });
    expect(output.readiness).toMatchObject({
      openingPositionQualified: false,
      budgetApproved: false,
    });
  });
  it("keeps flagged history in triage until opening evidence is qualified and isolates owners", async () => {
    const owner = await fixture();
    const other = await fixture();
    for (const context of [owner, other]) {
      const [account] = await database.db
        .insert(financeAccounts)
        .values({
          userId: context.principal.userId,
          institution: "Synthetic Bank",
          name: "Checking",
          provider: "manual",
          status: "manual",
        })
        .returning();
      if (!account) throw new Error("Missing account");
      await database.db.insert(financeTransactions).values({
        userId: context.principal.userId,
        accountId: account.id,
        merchant: "Synthetic purchase",
        amount: 1000,
        direction: "expense",
        transactionDate: "2026-10-31",
        needsReview: true,
      });
    }
    const prepared = await service().previewBudgetStart(owner, input());
    await service().applyBudgetStart(owner, {
      previewId: prepared.id,
      fingerprint: prepared.fingerprint,
    });
    expect(await service().getAttentionSnapshot(owner.principal.userId)).toMatchObject({
      activeTransactionCount: 1,
      triageRecordCount: 1,
      historicalRecordCount: 0,
      activeDecisionCount: 0,
      budgetReady: false,
      rawCounts: { transactionFlags: 1 },
    });
  });
  async function qualifiedBoundary() {
    const owner = await fixture();
    const [account] = await database.db
      .insert(financeAccounts)
      .values({
        userId: owner.principal.userId,
        institution: "Synthetic Bank",
        name: "Investments",
        kind: "investment",
        provider: "manual",
        status: "manual",
        currencyCode: "USD",
        ownershipType: "individual",
        ownershipShareBps: 10000,
        includeInPlanning: true,
      })
      .returning();
    if (!account) throw new Error("Missing account");
    await database.db.insert(financeOpeningStatements).values({
      userId: owner.principal.userId,
      accountId: account.id,
      month: "2026-11",
      revision: 1,
      accountRevision: account.contextualRevision.toString(),
      timezone: "America/New_York",
      signedOpeningBalanceCents: 100000,
      currencyCode: "USD",
      actorId: owner.principal.userId,
      idempotencyKey: crypto.randomUUID(),
      fingerprint: "fixture",
      recordedAt: new Date("2026-11-01T12:00:00Z"),
    });
    const preview = await service().previewBudgetStart(owner, input());
    await service().applyBudgetStart(owner, {
      previewId: preview.id,
      fingerprint: preview.fingerprint,
    });
    return { owner, account };
  }
  it("does not reactivate independent October history when December needs a new opening statement", async () => {
    const { owner, account } = await qualifiedBoundary();
    await database.db.insert(financeTransactions).values({
      userId: owner.principal.userId,
      accountId: account.id,
      merchant: "Old purchase",
      amount: 1000,
      direction: "expense",
      transactionDate: "2026-10-20",
      needsReview: true,
    });
    expect(await service().getAttentionSnapshot(owner.principal.userId)).toMatchObject({
      historicalRecordCount: 1,
      activeTransactionCount: 0,
    });
    const december = createFinanceAttentionService({
      db: database.db,
      now: () => new Date("2026-12-02T16:00:00Z"),
    });
    expect(await december.getAttentionSnapshot(owner.principal.userId)).toMatchObject({
      historicalRecordCount: 1,
      activeTransactionCount: 0,
      readiness: { openingPositionQualified: false },
    });
  });
  async function publishedBatch(mixed: boolean) {
    const { owner, account } = await qualifiedBoundary();
    const transactions = await database.db
      .insert(financeTransactions)
      .values(
        (mixed ? ["2026-10-20", "2026-11-10"] : ["2026-10-20"]).map((date) => ({
          userId: owner.principal.userId,
          accountId: account.id,
          merchant: "Reviewed purchase",
          amount: 1000,
          direction: "expense" as const,
          transactionDate: date,
          needsReview: true,
        })),
      )
      .returning();
    const [batch] = await database.db
      .insert(financeReviewBatchRuns)
      .values({
        userId: owner.principal.userId,
        actorType: "user",
        actorId: owner.principal.userId,
        idempotencyKey: crypto.randomUUID(),
        fingerprint: `sha256:${"a".repeat(64)}`,
        manifest: transactions.map((item) => ({
          decision: {
            kind: "categorization",
            transactionId: item.id,
            expectedTransactionRevision: item.contextualRevision.toString(),
            expectedTransactionUpdatedAt: item.updatedAt.toISOString(),
          },
          transactionSummary: { date: item.transactionDate },
        })),
      })
      .returning();
    if (!batch) throw new Error("Missing batch");
    await database.db.insert(financeConversationMessages).values({
      userId: owner.principal.userId,
      sequence: 1n,
      authorKind: "agent",
      text: "Review purchases",
      recordRefs: [{ kind: "review_batch", id: batch.id }],
      idempotencyKey: crypto.randomUUID(),
      createdAt: new Date("2026-11-12T12:00:00Z"),
    });
    return { owner, account, transactions, batch };
  }
  it.each([
    false,
    true,
  ])("scopes a published batch to its actual transactions (mixed=%s)", async (mixed) => {
    const { owner } = await publishedBatch(mixed);
    expect(await service().getAttentionSnapshot(owner.principal.userId)).toMatchObject({
      activeDecisionCount: mixed ? 1 : 0,
      historicalRecordCount: 2,
      rawCounts: { approvals: 1 },
    });
  });
  it.each([
    false,
    true,
  ])("scopes a published correction to both saved legs (mixed=%s)", async (mixed) => {
    const { owner, transactions, batch } = await publishedBatch(mixed);
    await database.db
      .update(financeReviewBatchRuns)
      .set({ outcomes: transactions.map((_, index) => ({ index, status: "applied" })) })
      .where(eq(financeReviewBatchRuns.id, batch.id));
    await database.db
      .update(financeTransactions)
      .set({ needsReview: false })
      .where(eq(financeTransactions.userId, owner.principal.userId));
    await database.db.insert(financeReviewBatchEffects).values({
      userId: owner.principal.userId,
      batchId: batch.id,
      outcomeIndex: 0,
      before: { transactions: transactions.map((item) => ({ id: item.id })) },
      after: {},
      createdAt: new Date("2026-11-12T12:00:00Z"),
    });
    const [correction] = await database.db
      .insert(financeReviewBatchCorrections)
      .values({
        userId: owner.principal.userId,
        batchId: batch.id,
        actorId: owner.principal.userId,
        actorType: "user",
        idempotencyKey: crypto.randomUUID(),
        fingerprint: "frozen-fixture",
        outcomeIndexes: [0],
      })
      .returning();
    if (!correction) throw new Error("Missing correction");
    await database.db.insert(financeConversationMessages).values({
      userId: owner.principal.userId,
      sequence: 2n,
      authorKind: "agent",
      text: "Review correction",
      createdAt: new Date("2026-11-12T12:00:00Z"),
      recordRefs: [{ kind: "review_batch_undo", id: correction.id }],
      idempotencyKey: crypto.randomUUID(),
    });
    expect(await service().getAttentionSnapshot(owner.principal.userId)).toMatchObject({
      activeDecisionCount: mixed ? 1 : 0,
      historicalRecordCount: 1,
      rawCounts: { approvals: 1 },
    });
    await database.db
      .update(financeReviewBatchCorrections)
      .set({ outcomes: [{ index: 0, status: "applied" }] })
      .where(eq(financeReviewBatchCorrections.id, correction.id));
    expect(await service().getAttentionSnapshot(owner.principal.userId)).toMatchObject({
      activeDecisionCount: 0,
      rawCounts: { approvals: 0 },
    });
  });
  it("does not keep a replaced or resolved terminal batch as an immortal blocker", async () => {
    const { owner, transactions, batch } = await publishedBatch(true);
    await database.db.insert(financeReviewBatchApprovals).values({
      userId: owner.principal.userId,
      batchId: batch.id,
      fingerprint: batch.fingerprint,
      approvedBy: owner.principal.userId,
      approvedAt: new Date("2026-11-12T12:00:00Z"),
      expiresAt: new Date("2026-11-13T12:00:00Z"),
      state: "completed_with_exceptions",
      nextAttemptAt: new Date("2026-11-12T12:00:00Z"),
      updatedAt: new Date("2026-11-12T12:00:00Z"),
    });
    expect(
      (await service().getAttentionSnapshot(owner.principal.userId)).technicalBlockerCount,
    ).toBe(1);
    await database.db
      .update(financeTransactions)
      .set({ needsReview: false })
      .where(eq(financeTransactions.userId, owner.principal.userId));
    expect(await service().getAttentionSnapshot(owner.principal.userId)).toMatchObject({
      technicalBlockerCount: 0,
      rawCounts: { approvals: 0 },
    });
    for (const item of transactions)
      await database.db
        .update(financeTransactions)
        .set({ needsReview: true, contextualRevision: item.contextualRevision + 1n })
        .where(eq(financeTransactions.id, item.id));
    expect(await service().getAttentionSnapshot(owner.principal.userId)).toMatchObject({
      technicalBlockerCount: 0,
      activeDecisionCount: 0,
      processingCount: 1,
      rawCounts: { approvals: 0 },
    });
  });
  it("promotes only history belonging to an unqualified account", async () => {
    const { owner, account } = await qualifiedBoundary();
    const [other] = await database.db
      .insert(financeAccounts)
      .values({
        userId: owner.principal.userId,
        institution: "Synthetic Bank",
        name: "Unknown opening",
        provider: "manual",
        status: "manual",
        includeInPlanning: true,
      })
      .returning();
    if (!other) throw new Error("Missing account");
    await database.db.insert(financeTransactions).values(
      [account, other].map((item) => ({
        userId: owner.principal.userId,
        accountId: item.id,
        merchant: "Old purchase",
        amount: 1000,
        direction: "expense" as const,
        transactionDate: "2026-10-20",
        needsReview: true,
      })),
    );
    expect(await service().getAttentionSnapshot(owner.principal.userId)).toMatchObject({
      historicalRecordCount: 1,
      activeTransactionCount: 1,
      triageRecordCount: 1,
    });
  });
  it("keeps an unlinked cross-boundary transfer candidate active with a qualified opening", async () => {
    const { owner, account } = await qualifiedBoundary();
    const [other] = await database.db
      .insert(financeAccounts)
      .values({
        userId: owner.principal.userId,
        institution: "Synthetic Bank",
        name: "Other",
        provider: "manual",
        status: "manual",
        includeInPlanning: false,
      })
      .returning();
    if (!other) throw new Error("Missing other account");
    await database.db.insert(financeTransactions).values([
      {
        userId: owner.principal.userId,
        accountId: account.id,
        merchant: "Outgoing",
        amount: 1000,
        direction: "expense",
        providerDirection: "expense",
        providerCategory: "TRANSFER_OUT",
        currencyCode: "USD",
        transactionDate: "2026-10-31",
        needsReview: true,
      },
      {
        userId: owner.principal.userId,
        accountId: other.id,
        merchant: "Incoming",
        amount: 1000,
        direction: "income",
        providerDirection: "income",
        providerCategory: "TRANSFER_IN",
        currencyCode: "USD",
        transactionDate: "2026-11-01",
        needsReview: true,
      },
    ]);
    expect(await service().getAttentionSnapshot(owner.principal.userId)).toMatchObject({
      historicalRecordCount: 0,
      activeTransactionCount: 2,
      readiness: { openingPositionQualified: true },
    });
  });
  it("lets the owner inspect an agent preview without leaking it to another owner or agent", async () => {
    const owner = await fixture();
    const other = await fixture();
    const agent = {
      ...owner,
      principal: { ...owner.principal, actorType: "agent" as const, actorId: crypto.randomUUID() },
    };
    const prepared = await service().previewBudgetStart(agent, input());
    expect(await service().getBudgetStartPreview(owner, prepared.id)).toEqual(prepared);
    expect(await service().getBudgetStartPreview(agent, prepared.id)).toEqual(prepared);
    await expect(service().getBudgetStartPreview(other, prepared.id)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      service().getBudgetStartPreview(
        { ...agent, principal: { ...agent.principal, actorId: crypto.randomUUID() } },
        prepared.id,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      service().applyBudgetStart(agent, {
        previewId: prepared.id,
        fingerprint: prepared.fingerprint,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await service().getBudgetStart(owner.principal.userId)).toBeNull();
  });
  it("requires an exact preview, records server-derived approval, and replays safely", async () => {
    const context = await fixture();
    const prepared = await service().previewBudgetStart(context, input());
    expect(await service().getBudgetStart(context.principal.userId)).toBeNull();
    expect(prepared.attention).toMatchObject({
      period: "2026-11",
      complete: true,
      budgetReady: false,
    });
    expect(prepared.attention.snapshot).toMatch(/^[a-f0-9]{64}$/);
    await expect(
      service().applyBudgetStart(context, {
        previewId: prepared.id,
        fingerprint: `sha256:${"0".repeat(64)}`,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    const result = await service().applyBudgetStart(context, {
      previewId: prepared.id,
      fingerprint: prepared.fingerprint,
    });
    expect(result).toMatchObject({
      firstMonth: "2026-11",
      timezone: "America/New_York",
      revision: 1,
      approvalSource: "user_instruction",
    });
    expect(
      await service().applyBudgetStart(context, {
        previewId: prepared.id,
        fingerprint: prepared.fingerprint,
      }),
    ).toEqual(result);
  });
  it("rejects another owner and never lets an agent impersonate approval", async () => {
    const owner = await fixture();
    const other = await fixture();
    const prepared = await service().previewBudgetStart(owner, input());
    const apply = { previewId: prepared.id, fingerprint: prepared.fingerprint };
    await expect(service().applyBudgetStart(other, apply)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      service().applyBudgetStart(
        {
          ...owner,
          principal: { ...owner.principal, actorType: "agent", actorId: crypto.randomUUID() },
        },
        apply,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
  it("invalidates competing previews and permits a reviewed reversal without deleting history", async () => {
    const context = await fixture();
    const first = await service().previewBudgetStart(context, input());
    const stale = await service().previewBudgetStart(context, input());
    await service().applyBudgetStart(context, {
      previewId: first.id,
      fingerprint: first.fingerprint,
    });
    await expect(
      service().applyBudgetStart(context, { previewId: stale.id, fingerprint: stale.fingerprint }),
    ).rejects.toMatchObject({ code: "conflict" });
    const reversal = await service().previewBudgetStart(context, {
      ...input(),
      firstMonth: null,
      expectedPolicyRevision: 1,
    });
    expect(
      await service().applyBudgetStart(context, {
        previewId: reversal.id,
        fingerprint: reversal.fingerprint,
      }),
    ).toMatchObject({ firstMonth: null, revision: 2 });
  });
  it("rejects a reused preview key with changed intent", async () => {
    const context = await fixture();
    const request = input();
    const prepared = await service().previewBudgetStart(context, request);
    expect(await service().previewBudgetStart(context, request)).toEqual(prepared);
    await expect(
      service().previewBudgetStart(context, { ...request, firstMonth: "2026-10" }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});
