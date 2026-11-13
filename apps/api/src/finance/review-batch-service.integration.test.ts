import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  accessTokens,
  auditEvents,
  createDatabaseClient,
  type DatabaseClient,
  executionPolicySettings,
  financeAccounts,
  financeCategories,
  financeClassificationDecisions,
  financeConversationMessages,
  financeMerchants,
  financeProviderItems,
  financeReviewActionRequests,
  financeReviewBatchApprovals,
  financeReviewBatchEffects,
  financeReviewBatchRuns,
  financeReviewCases,
  financeTransactions,
  migrateDatabase,
  nativePushEvents,
  users,
} from "@personal-os/database";
import {
  decideFinanceReviewActionTransition,
  type FinanceReviewBatchDecision,
  issueFinanceReviewAction,
  previewFinanceReviewBatchInputSchema,
} from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq, sql } from "drizzle-orm";
import type { PoolClient } from "pg";
import { createFinanceService } from "../finance-service.js";
import type { Principal } from "../types.js";
import { validateFinanceCompletionBatch } from "./completion-service.js";
import { createFinanceReviewBatchService } from "./review-batch-service.js";

const stamp = new Date("2026-10-24T12:00:00.000Z");
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing test fixture");
  return value;
}
const now = () => new Date("2026-10-24T12:01:00.000Z");
describe.sequential("durable Finance review batches", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120_000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });

  async function fixture(count = 1, review = false) {
    const userId = randomUUID();
    const accountId = randomUUID();
    const categoryId = randomUUID();
    await database.db.insert(users).values({
      id: userId,
      displayName: "Batch owner",
      email: `${userId}@example.com`,
      passwordHash: "unused",
    });
    await database.db.insert(financeAccounts).values({
      id: accountId,
      userId,
      institution: "Fixture",
      name: "Checking",
      provider: "manual",
      status: "connected",
    });
    await database.db.insert(financeCategories).values({
      id: categoryId,
      userId,
      name: "Food",
      slug: "food",
      group: "Living",
      isSystem: false,
    });
    const decisions: FinanceReviewBatchDecision[] = [];
    for (let index = 0; index < count; index++) {
      const transactionId = randomUUID();
      await database.db.insert(financeTransactions).values({
        id: transactionId,
        userId,
        accountId,
        merchant: "Fixture grocery",
        amount: 1500,
        direction: "expense",
        transactionDate: "2026-10-24",
        needsReview: true,
        updatedAt: stamp,
      });
      const base = {
        transactionId,
        expectedTransactionUpdatedAt: stamp.toISOString(),
        expectedTransactionRevision: "1",
        categoryId,
        confidence: 1,
        rationale: "Owner reviewed the receipt.",
        evidence: "Receipt identifies grocery purchases for this transaction.",
        learnMerchant: "never" as const,
      };
      if (review) {
        const reviewId = randomUUID();
        await database.db.insert(financeReviewCases).values({
          id: reviewId,
          userId,
          transactionId,
          reason: "low_confidence",
          updatedAt: stamp,
        });
        decisions.push({
          ...base,
          kind: "review",
          reviewId,
          expectedReviewUpdatedAt: stamp.toISOString(),
          expectedReviewRevision: "1",
          expectedActionRevision: "0",
          action: "recategorize",
        });
      } else decisions.push({ ...base, kind: "categorization" });
    }
    const principal: Principal = {
      actorId: userId,
      actorType: "user",
      userId,
      scopes: new Set(["finances:read", "finances:write"]),
    };
    const context = { principal, requestId: randomUUID() };
    const finance = createFinanceService({ db: database.db, now });
    const service = createFinanceReviewBatchService({ db: database.db, now, finance });
    return {
      userId,
      decisions,
      context,
      service,
      finance,
      input: { idempotencyKey: randomUUID(), decisions },
    };
  }
  it("freezes server-owned transaction identity and amount with the reviewed manifest", async () => {
    const f = await fixture();
    const preview = await f.service.preview(f.input, f.context);
    expect(preview).toMatchObject({
      transactionSummaries: [
        {
          index: 0,
          merchant: "Fixture grocery",
          amountCents: 1500,
          currencyCode: null,
          date: "2026-10-24",
        },
      ],
    });
    await database.db
      .update(financeTransactions)
      .set({ merchant: "Changed later", amount: 2500 })
      .where(eq(financeTransactions.id, required(f.decisions[0]).transactionId));
    expect(await f.service.get(preview.id, f.context)).toMatchObject({
      transactionSummaries: [{ merchant: "Fixture grocery", amountCents: 1500 }],
    });
  });
  async function agent(userId: string, execute = true) {
    const principal: Principal = {
      actorId: randomUUID(),
      actorType: "agent",
      userId,
      authorizationConnectionId: randomUUID(),
      scopes: new Set(
        execute
          ? ["finances:read", "finances:write", "finances:execute"]
          : ["finances:read", "finances:write"],
      ),
    };
    await database.db.insert(accessTokens).values({
      id: principal.actorId,
      userId,
      name: "Batch agent",
      authorizationConnectionId: principal.authorizationConnectionId,
      tokenHash: randomUUID(),
      scopes: [...principal.scopes],
    });
    await database.db
      .insert(executionPolicySettings)
      .values({ userId, reviewBypassEnabled: true })
      .onConflictDoNothing();
    return { principal, requestId: randomUUID() };
  }
  async function transaction(id: string) {
    return database.db.query.financeTransactions.findFirst({
      where: eq(financeTransactions.id, id),
    });
  }
  async function transferFixture(action: "confirm_transfer" | "recategorize" = "confirm_transfer") {
    const f = await fixture(2, true);
    const decision = required(f.decisions[0]);
    const following = required(f.decisions[1]);
    if (decision.kind !== "review" || following.kind !== "review") throw new Error("fixture");
    decision.action = action;
    decision.evidence = "Signed source records show opposite USD movements between owned accounts.";
    following.action = "defer";
    await database.db
      .update(financeReviewCases)
      .set({ reason: "possible_transfer" })
      .where(eq(financeReviewCases.id, decision.reviewId));
    await database.db
      .update(financeTransactions)
      .set({
        direction: "transfer",
        providerDirection: "expense",
        providerCategory: "TRANSFER_OUT",
        currencyCode: "USD",
        reconciliationStatus: "candidate",
      })
      .where(eq(financeTransactions.id, decision.transactionId));
    const counterpartAccountId = randomUUID();
    await database.db.insert(financeAccounts).values({
      id: counterpartAccountId,
      userId: f.userId,
      institution: "Fixture",
      name: "Savings",
      provider: "manual",
      status: "connected",
    });
    const [counterpart] = await database.db
      .insert(financeTransactions)
      .values({
        userId: f.userId,
        accountId: counterpartAccountId,
        merchant: "Internal movement",
        amount: 1500,
        direction: "transfer",
        providerDirection: "income",
        providerCategory: "TRANSFER_IN",
        currencyCode: "USD",
        transactionDate: "2026-10-24",
        updatedAt: stamp,
      })
      .returning();
    const current = required(await transaction(decision.transactionId));
    const review = required(
      await database.db.query.financeReviewCases.findFirst({
        where: eq(financeReviewCases.id, decision.reviewId),
      }),
    );
    decision.expectedTransactionRevision = current.contextualRevision.toString();
    decision.expectedReviewRevision = review.contextualRevision.toString();
    return {
      ...f,
      decision,
      following,
      counterpart: required(counterpart),
      agentContext: await agent(f.userId),
    };
  }
  async function pairFixture(caseCount = 0) {
    const f = await transferFixture();
    await database.db.delete(financeReviewCases).where(eq(financeReviewCases.userId, f.userId));
    await database.db
      .update(financeAccounts)
      .set({ status: "manual", ownershipType: "individual", ownershipShareBps: 10000 })
      .where(eq(financeAccounts.userId, f.userId));
    for (const id of [f.decision.transactionId, f.counterpart.id].slice(0, caseCount)) {
      await database.db
        .insert(financeReviewCases)
        .values({ userId: f.userId, transactionId: id, reason: "possible_transfer" });
    }
    const left = required(await transaction(f.decision.transactionId));
    const right = required(await transaction(f.counterpart.id));
    const decision = {
      kind: "transfer_pair",
      transactionId: left.id,
      expectedTransactionUpdatedAt: left.updatedAt.toISOString(),
      expectedTransactionRevision: left.contextualRevision.toString(),
      counterpartTransactionId: right.id,
      expectedCounterpartUpdatedAt: right.updatedAt.toISOString(),
      expectedCounterpartRevision: right.contextualRevision.toString(),
      rationale: "The two signed source movements match between fully owned accounts.",
      evidence: "Exact USD pair and account ownership.",
      confidence: 1,
      learnMerchant: "never",
    };
    return { ...f, left, right, pairDecision: decision };
  }
  it("does not treat a unique heuristic transfer candidate as authority to exclude spending", async () => {
    const f = await pairFixture();
    const preview = await f.service.preview(
      { idempotencyKey: randomUUID(), decisions: [f.pairDecision] },
      f.agentContext,
    );
    await expect(
      f.service.execute(preview.id, { fingerprint: preview.fingerprint }, f.agentContext),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await transaction(f.left.id)).toMatchObject({ needsReview: true });
    expect(await transaction(f.right.id)).toMatchObject({ needsReview: true });
  });
  it("rejects direct owner execution without an explicit transfer attestation", async () => {
    const f = await pairFixture();
    const preview = await f.service.preview(
      { idempotencyKey: randomUUID(), decisions: [f.pairDecision] },
      f.context,
    );
    await expect(
      f.service.execute(preview.id, { fingerprint: preview.fingerprint }, f.context),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await transaction(f.left.id)).toMatchObject({ needsReview: true });
  });
  it("accepts sign-consistent detailed provider transfer categories as candidates", async () => {
    const f = await pairFixture();
    await database.db
      .update(financeTransactions)
      .set({ providerCategoryDetailed: "TRANSFER_OUT_ACCOUNT_TRANSFER" })
      .where(eq(financeTransactions.id, f.left.id));
    const left = required(await transaction(f.left.id));
    const preview = await f.service.preview(
      {
        idempotencyKey: randomUUID(),
        decisions: [
          {
            ...f.pairDecision,
            expectedTransactionRevision: left.contextualRevision.toString(),
            expectedTransactionUpdatedAt: left.updatedAt.toISOString(),
          },
        ],
      },
      f.context,
    );
    expect(preview.pendingCount).toBe(1);
  });
  it("does not execute a legacy approval without the saved pair attestation", async () => {
    const f = await pairFixture();
    const preview = await f.service.preview(
      { idempotencyKey: randomUUID(), decisions: [f.pairDecision] },
      f.context,
    );
    await f.service.approveForContinuation(
      preview.id,
      { fingerprint: preview.fingerprint, confirmTransferPairs: true },
      f.context,
    );
    const events = await database.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.userId, f.userId),
          eq(auditEvents.action, "finance_review_batch.approved"),
        ),
      );
    for (const event of events) {
      const { confirmedTransferPairIndexes: _old, ...legacy } = event.after ?? {};
      await database.db
        .update(auditEvents)
        .set({ after: legacy })
        .where(eq(auditEvents.id, event.id));
    }
    await f.service.processApproved();
    expect(await transaction(f.left.id)).toMatchObject({
      needsReview: true,
      transferGroupId: null,
    });
    expect(await f.service.getContinuation(preview.id, f.context)).toMatchObject({
      state: "blocked",
    });
  });
  it("rejects a legacy pair preview missing frozen counterpart details on both execution paths", async () => {
    const f = await pairFixture();
    const preview = await f.service.preview(
      { idempotencyKey: randomUUID(), decisions: [f.pairDecision] },
      f.context,
    );
    const stored = required(
      await database.db.query.financeReviewBatchRuns.findFirst({
        where: eq(financeReviewBatchRuns.id, preview.id),
      }),
    );
    const manifest = stored.manifest.map((raw) => {
      const item = raw as { transferCounterpart?: { summary?: unknown } };
      const copy = structuredClone(item);
      if (copy.transferCounterpart) delete copy.transferCounterpart.summary;
      return copy;
    });
    await database.db
      .update(financeReviewBatchRuns)
      .set({ manifest })
      .where(eq(financeReviewBatchRuns.id, preview.id));
    await expect(
      f.service.approveForContinuation(
        preview.id,
        { fingerprint: preview.fingerprint, confirmTransferPairs: true },
        f.context,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      f.service.execute(
        preview.id,
        { fingerprint: preview.fingerprint, confirmTransferPairs: true },
        f.context,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
  it("requires explicit owner confirmation of the transfer pairs in an approved batch", async () => {
    const f = await pairFixture();
    const preview = await f.service.preview(
      { idempotencyKey: randomUUID(), decisions: [f.pairDecision] },
      f.agentContext,
    );
    await expect(
      f.service.approveForContinuation(preview.id, { fingerprint: preview.fingerprint }, f.context),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await f.service.approveForContinuation(
      preview.id,
      { fingerprint: preview.fingerprint, confirmTransferPairs: true },
      f.context,
    );
    await f.service.processApproved();
    const left = required(await transaction(f.left.id));
    const right = required(await transaction(f.right.id));
    expect(left.transferGroupId).toBeTruthy();
    expect(right.transferGroupId).toBe(left.transferGroupId);
    expect(left.direction).toBe("transfer");
  });
  it.each([
    0, 1, 2,
  ])("resolves an exact transfer pair with %i existing cases without inventing reviews", async (caseCount) => {
    const f = await pairFixture(caseCount);
    const { left, right, pairDecision: decision } = f;
    const preview = await f.service.preview(
      { idempotencyKey: randomUUID(), decisions: [decision] },
      f.context,
    );
    const result = await f.service.execute(
      preview.id,
      { fingerprint: preview.fingerprint, confirmTransferPairs: true },
      f.context,
    );
    expect(result).toMatchObject({ status: "completed", outcomes: [{ status: "applied" }] });
    expect(await transaction(left.id)).toMatchObject({
      needsReview: false,
      direction: "transfer",
      reconciliationStatus: "confirmed",
    });
    expect(await transaction(right.id)).toMatchObject({
      needsReview: false,
      direction: "transfer",
      reconciliationStatus: "confirmed",
    });
    const cases = await database.db.query.financeReviewCases.findMany({
      where: eq(financeReviewCases.userId, f.userId),
    });
    expect(cases).toHaveLength(caseCount);
    expect(cases.every((row) => row.status === "resolved")).toBe(true);
    expect(
      await f.service.execute(
        preview.id,
        { fingerprint: preview.fingerprint, confirmTransferPairs: true },
        f.context,
      ),
    ).toEqual(result);
  });
  it("keeps unrelated review reasons open when the transfer pair is resolved", async () => {
    const f = await pairFixture(2);
    const [unrelated] = await database.db
      .insert(financeReviewCases)
      .values({ userId: f.userId, transactionId: f.left.id, reason: "possible_reimbursement" })
      .returning();
    const preview = await f.service.preview(
      { idempotencyKey: randomUUID(), decisions: [f.pairDecision] },
      f.context,
    );
    await f.service.execute(
      preview.id,
      { fingerprint: preview.fingerprint, confirmTransferPairs: true },
      f.context,
    );
    expect(await transaction(f.left.id)).toMatchObject({ needsReview: true });
    expect(await transaction(f.right.id)).toMatchObject({ needsReview: false });
    expect(
      await database.db.query.financeReviewCases.findFirst({
        where: eq(financeReviewCases.id, required(unrelated).id),
      }),
    ).toMatchObject({ status: "open" });
  });
  it.each([
    "pending",
    "currency",
    "fees",
    "sign mismatch",
    "unknown destination",
    "source stale",
    "ambiguous",
  ])("rejects a transfer pair with %s evidence", async (scenario) => {
    const f = await pairFixture();
    if (scenario === "pending")
      await database.db
        .update(financeTransactions)
        .set({ pending: true })
        .where(eq(financeTransactions.id, f.right.id));
    if (scenario === "currency")
      await database.db
        .update(financeTransactions)
        .set({ currencyCode: "EUR" })
        .where(eq(financeTransactions.id, f.right.id));
    if (scenario === "sign mismatch")
      await database.db
        .update(financeTransactions)
        .set({ providerCategory: "TRANSFER_OUT" })
        .where(eq(financeTransactions.id, f.right.id));
    if (scenario === "fees")
      await database.db
        .update(financeTransactions)
        .set({ amount: 1499 })
        .where(eq(financeTransactions.id, f.right.id));
    if (scenario === "unknown destination")
      await database.db
        .update(financeAccounts)
        .set({ ownershipType: "unknown", ownershipShareBps: null })
        .where(eq(financeAccounts.id, f.right.accountId));
    if (scenario === "source stale")
      await database.db
        .update(financeAccounts)
        .set({ status: "needs_reauth" })
        .where(eq(financeAccounts.id, f.right.accountId));
    if (scenario === "ambiguous")
      await database.db.insert(financeTransactions).values({
        userId: f.userId,
        accountId: f.right.accountId,
        merchant: "Other equal movement",
        amount: f.right.amount,
        direction: "transfer",
        providerDirection: "income",
        providerCategory: "TRANSFER_IN",
        currencyCode: "USD",
        transactionDate: f.right.transactionDate,
      });
    const right = required(await transaction(f.right.id));
    const decision = {
      ...f.pairDecision,
      expectedCounterpartRevision: right.contextualRevision.toString(),
      expectedCounterpartUpdatedAt: right.updatedAt.toISOString(),
    };
    await expect(
      f.service.preview({ idempotencyKey: randomUUID(), decisions: [decision] }, f.agentContext),
    ).rejects.toBeInstanceOf(Error);
    expect(await transaction(f.left.id)).toMatchObject({ needsReview: true });
  });
  it("refuses a changed case or source between pair preview and execution", async () => {
    const f = await pairFixture(1);
    const preview = await f.service.preview(
      { idempotencyKey: randomUUID(), decisions: [f.pairDecision] },
      f.agentContext,
    );
    await database.db
      .update(financeReviewCases)
      .set({ reason: "possible_reimbursement" })
      .where(eq(financeReviewCases.userId, f.userId));
    expect(
      await f.service.execute(
        preview.id,
        { fingerprint: preview.fingerprint, confirmTransferPairs: true },
        f.agentContext,
      ),
    ).toMatchObject({
      status: "completed_with_exceptions",
      outcomes: [{ status: "failed", recovery: "new_preview" }],
    });
    expect(await transaction(f.left.id)).toMatchObject({ needsReview: true });
    expect(await transaction(f.right.id)).toMatchObject({ needsReview: true });
  });
  it("undoes a pair as a new audited correction and replays the receipt without repeating effects", async () => {
    const f = await pairFixture(2);
    const preview = await f.service.preview(
      { idempotencyKey: randomUUID(), decisions: [f.pairDecision] },
      f.context,
    );
    await f.service.execute(
      preview.id,
      { fingerprint: preview.fingerprint, confirmTransferPairs: true },
      f.context,
    );
    const applied = required(await transaction(f.left.id));
    const correction = await f.service.previewUndo(
      { batchId: preview.id, outcomeIndexes: [0], idempotencyKey: randomUUID() },
      f.context,
    );
    expect(correction.effects).toEqual([
      expect.objectContaining({
        index: 0,
        transactions: expect.arrayContaining([
          expect.objectContaining({
            id: f.left.id,
            merchant: f.left.merchant,
            amountCents: f.left.amount,
            before: expect.objectContaining({ category: f.left.category, needsReview: true }),
            after: expect.objectContaining({ direction: "transfer", needsReview: false }),
          }),
          expect.objectContaining({ id: f.right.id, merchant: f.right.merchant }),
        ]),
        reopenedReviews: expect.arrayContaining([
          expect.objectContaining({ reason: "possible_transfer" }),
        ]),
      }),
    ]);
    const result = await f.service.executeUndo(
      correction.id,
      { fingerprint: correction.fingerprint, limit: 10 },
      f.context,
    );
    expect(result).toMatchObject({ status: "completed", outcomes: [{ status: "applied" }] });
    const restored = required(await transaction(f.left.id));
    expect(restored).toMatchObject({
      categoryId: f.left.categoryId,
      transferGroupId: null,
      needsReview: true,
      reconciliationStatus: f.left.reconciliationStatus,
    });
    expect(restored.contextualRevision > applied.contextualRevision).toBe(true);
    const classificationEvidence = await database.db.query.financeClassificationDecisions.findMany({
      where: eq(financeClassificationDecisions.userId, f.userId),
    });
    expect(classificationEvidence).toHaveLength(2);
    expect(
      classificationEvidence.every((row) => "retractedAt" in row && row.retractedAt !== null),
    ).toBe(true);
    expect(await transaction(f.right.id)).toMatchObject({
      categoryId: f.right.categoryId,
      needsReview: true,
    });
    expect(
      (
        await database.db.query.financeReviewCases.findMany({
          where: eq(financeReviewCases.userId, f.userId),
        })
      ).every((row) => row.status === "open"),
    ).toBe(true);
    expect(
      await f.service.executeUndo(
        correction.id,
        { fingerprint: correction.fingerprint, limit: 10 },
        f.context,
      ),
    ).toEqual(result);
  });
  it("rejects a saved legacy correction without frozen impact details before changing either leg", async () => {
    const f = await pairFixture(2);
    const preview = await f.service.preview(
      { idempotencyKey: randomUUID(), decisions: [f.pairDecision] },
      f.context,
    );
    await f.service.execute(
      preview.id,
      { fingerprint: preview.fingerprint, confirmTransferPairs: true },
      f.context,
    );
    const correction = await f.service.previewUndo(
      { batchId: preview.id, outcomeIndexes: [0], idempotencyKey: randomUUID() },
      f.context,
    );
    const beforeLeft = await transaction(f.left.id);
    const beforeRight = await transaction(f.right.id);
    await database.db
      .update(financeReviewBatchEffects)
      .set({ before: sql`${financeReviewBatchEffects.before} - 'display'` })
      .where(eq(financeReviewBatchEffects.batchId, preview.id));
    await expect(
      f.service.executeUndo(
        correction.id,
        { fingerprint: correction.fingerprint, limit: 10 },
        f.context,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await transaction(f.left.id)).toEqual(beforeLeft);
    expect(await transaction(f.right.id)).toEqual(beforeRight);
  });
  it("refuses undo after a later edit instead of overwriting that edit", async () => {
    const f = await pairFixture();
    const preview = await f.service.preview(
      { idempotencyKey: randomUUID(), decisions: [f.pairDecision] },
      f.context,
    );
    await f.service.execute(
      preview.id,
      { fingerprint: preview.fingerprint, confirmTransferPairs: true },
      f.context,
    );
    const correction = await f.service.previewUndo(
      { batchId: preview.id, outcomeIndexes: [0], idempotencyKey: randomUUID() },
      f.context,
    );
    await database.db
      .update(financeTransactions)
      .set({ notes: "Later owner edit" })
      .where(eq(financeTransactions.id, f.left.id));
    const result = await f.service.executeUndo(
      correction.id,
      { fingerprint: correction.fingerprint, limit: 10 },
      f.context,
    );
    expect(result).toMatchObject({
      status: "completed_with_exceptions",
      outcomes: [{ status: "failed", recovery: "new_preview" }],
    });
    expect(await transaction(f.left.id)).toMatchObject({
      notes: "Later owner edit",
      reconciliationStatus: "confirmed",
    });
  });
  it("guards correction authority and serializes duplicate correction execution", async () => {
    const f = await pairFixture();
    const other = await fixture();
    const preview = await f.service.preview(
      { idempotencyKey: randomUUID(), decisions: [f.pairDecision] },
      f.agentContext,
    );
    await f.service.execute(
      preview.id,
      { fingerprint: preview.fingerprint, confirmTransferPairs: true },
      f.context,
    );
    const input = { batchId: preview.id, outcomeIndexes: [0], idempotencyKey: randomUUID() };
    const correction = await f.service.previewUndo(input, f.agentContext);
    expect(await f.service.previewUndo(input, f.agentContext)).toEqual(correction);
    await expect(f.service.getUndo(correction.id, other.context)).rejects.toMatchObject({
      code: "not_found",
    });
    const alternateAgent = await agent(f.userId);
    await expect(f.service.getUndo(correction.id, alternateAgent)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      f.service.executeUndo(
        correction.id,
        { fingerprint: `sha256:${"0".repeat(64)}` },
        f.agentContext,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await database.db
      .update(accessTokens)
      .set({ revokedAt: now() })
      .where(eq(accessTokens.id, f.agentContext.principal.actorId));
    await expect(
      f.service.executeUndo(correction.id, { fingerprint: correction.fingerprint }, f.agentContext),
    ).rejects.toMatchObject({ code: "forbidden" });
    const [a, b] = await Promise.all([
      f.service.executeUndo(correction.id, { fingerprint: correction.fingerprint }, f.context),
      f.service.executeUndo(correction.id, { fingerprint: correction.fingerprint }, f.context),
    ]);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ status: "completed", outcomes: [{ status: "applied" }] });
  });
  it("rolls back a lost correction writer and resumes without duplicate effects", async () => {
    const f = await pairFixture(1);
    const preview = await f.service.preview(
      { idempotencyKey: randomUUID(), decisions: [f.pairDecision] },
      f.context,
    );
    await f.service.execute(
      preview.id,
      { fingerprint: preview.fingerprint, confirmTransferPairs: true },
      f.context,
    );
    const correction = await f.service.previewUndo(
      { batchId: preview.id, outcomeIndexes: [0], idempotencyKey: randomUUID() },
      f.context,
    );
    let fail = true;
    const service = createFinanceReviewBatchService({
      db: database.db,
      now,
      finance: {
        ...f.finance,
        async restoreReviewBatchEffect(...args) {
          await f.finance.restoreReviewBatchEffect(...args);
          if (fail) {
            fail = false;
            throw new Error("Synthetic correction process loss");
          }
        },
      },
    });
    await expect(
      service.executeUndo(correction.id, { fingerprint: correction.fingerprint }, f.context),
    ).rejects.toThrow("Synthetic correction process loss");
    expect(await transaction(f.left.id)).toMatchObject({ reconciliationStatus: "confirmed" });
    expect(await service.getUndo(correction.id, f.context)).toMatchObject({
      pendingCount: 1,
      outcomes: [],
    });
    expect(
      await service.executeUndo(correction.id, { fingerprint: correction.fingerprint }, f.context),
    ).toMatchObject({ status: "completed" });
  });
  async function qualifyFixture() {
    const f = await transferFixture();
    await database.db
      .update(financeAccounts)
      .set({ status: "manual" })
      .where(eq(financeAccounts.userId, f.userId));
    await database.db
      .update(financeTransactions)
      .set({ currencyCode: "USD" })
      .where(eq(financeTransactions.id, f.following.transactionId));
    f.following.expectedTransactionRevision = required(
      await transaction(f.following.transactionId),
    ).contextualRevision.toString();
    return f;
  }
  it("qualifies an independent exact pair while retaining stale and inaccessible work without writes", async () => {
    const f = await qualifyFixture();
    const foreign = await fixture();
    const stale = { ...f.following, expectedTransactionRevision: "999" };
    const before = await transaction(f.decision.transactionId);
    const result = await f.service.qualify(
      { decisions: [f.decision, stale, required(foreign.decisions[0])] },
      f.agentContext,
    );
    expect(result.items.map(({ state }) => state)).toEqual([
      "eligible",
      "awaiting_evidence",
      "source_blocked",
    ]);
    expect(result.items[0]?.sourceRefs.map(({ transactionId }) => transactionId)).toEqual([
      f.decision.transactionId,
      f.counterpart.id,
    ]);
    expect(result.items[1]?.reasons).toContain("stale_decision");
    expect(result.items[2]?.sourceRefs).toEqual([]);
    expect(result).toMatchObject({
      advisoryOnly: true,
      previewRequired: true,
      executionRevalidationRequired: true,
    });
    expect(await transaction(f.decision.transactionId)).toEqual(before);
    expect(
      await database.db
        .select()
        .from(financeReviewBatchRuns)
        .where(eq(financeReviewBatchRuns.userId, f.userId)),
    ).toEqual([]);
    expect(
      await database.db.select().from(auditEvents).where(eq(auditEvents.userId, f.userId)),
    ).toEqual([]);
  });
  it("qualifies categorization only against the current server-owned merchant evidence", async () => {
    const f = await fixture(4);
    const base = required(f.decisions[0]);
    if (base.kind !== "categorization") throw new Error("Missing category fixture");
    const [merchant] = await database.db
      .insert(financeMerchants)
      .values({
        userId: f.userId,
        displayName: "Blue Finch Fixture",
        normalizedName: "blue finch fixture",
      })
      .returning();
    await database.db
      .update(financeAccounts)
      .set({ status: "manual" })
      .where(eq(financeAccounts.userId, f.userId));
    await database.db
      .update(financeTransactions)
      .set({
        merchantId: required(merchant).id,
        merchant: "Blue Finch Fixture",
        currencyCode: "USD",
      })
      .where(eq(financeTransactions.userId, f.userId));
    for (const decision of f.decisions.slice(1))
      await database.db.insert(financeClassificationDecisions).values({
        userId: f.userId,
        transactionId: decision.transactionId,
        merchantId: required(merchant).id,
        categoryId: base.categoryId,
        categoryName: "Food",
        source: "user",
        confidence: 10000,
        outcome: "confirmed",
      });
    const proposals = await f.finance.proposeCategorizations(f.userId, {
      limit: 10,
      review: "needs_review",
    });
    const proposal = required(
      proposals.items.find((row) => row.transaction.id === base.transactionId),
    );
    expect(proposal.meetsPolicyThreshold).toBe(true);
    const current = required(await transaction(base.transactionId));
    const decision = {
      ...base,
      confidence: proposal.confidence,
      expectedTransactionRevision: current.contextualRevision.toString(),
    };
    const result = await f.service.qualify({ decisions: [decision] }, await agent(f.userId));
    expect(result.items[0]).toMatchObject({ state: "eligible", reasons: [] });
    const wrong = await f.service.qualify(
      { decisions: [{ ...decision, confidence: 0.01 }] },
      await agent(f.userId),
    );
    expect(wrong.items[0]?.state).toBe("awaiting_evidence");
    await database.db
      .update(financeClassificationDecisions)
      .set({ retractedAt: now() })
      .where(eq(financeClassificationDecisions.userId, f.userId));
    const retracted = await f.service.qualify({ decisions: [decision] }, await agent(f.userId));
    expect(retracted.items[0]?.state).toBe("awaiting_evidence");
  });
  it("does not infer evidence readiness from valid current rows or confidence", async () => {
    const f = await fixture();
    await database.db
      .update(financeAccounts)
      .set({ status: "manual" })
      .where(eq(financeAccounts.userId, f.userId));
    await database.db
      .update(financeTransactions)
      .set({ currencyCode: "USD" })
      .where(eq(financeTransactions.id, required(f.decisions[0]).transactionId));
    const current = required(await transaction(required(f.decisions[0]).transactionId));
    const result = await f.service.qualify(
      {
        decisions: [
          {
            ...required(f.decisions[0]),
            expectedTransactionRevision: current.contextualRevision.toString(),
            confidence: 1,
          },
        ],
      },
      await agent(f.userId),
    );
    expect(result.items[0]).toMatchObject({
      state: "awaiting_evidence",
      reasons: ["decision_evidence_not_qualified"],
    });
  });
  it("checks the counterpart source rather than borrowing the primary account's readiness", async () => {
    const f = await qualifyFixture();
    await database.db
      .update(financeAccounts)
      .set({ status: "needs_reauth" })
      .where(eq(financeAccounts.id, f.counterpart.accountId));
    const result = await f.service.qualify({ decisions: [f.decision] }, f.agentContext);
    expect(result.items[0]).toMatchObject({
      state: "source_blocked",
      reasons: ["counterpart_source_not_current"],
    });
  });
  it("uses authoritative Item and account freshness without borrowing a healthy source", async () => {
    const f = await qualifyFixture();
    const primary = required(await transaction(f.decision.transactionId));
    const [item] = await database.db
      .insert(financeProviderItems)
      .values({
        userId: f.userId,
        provider: "plaid",
        providerItemId: "qualification-item",
        encryptedCredentials: { ciphertext: "unused", iv: "unused", tag: "unused", version: 1 },
        syncState: "current",
        lastSyncedAt: stamp,
      })
      .returning();
    const provider = required(item);
    await database.db
      .update(financeAccounts)
      .set({
        provider: "plaid",
        status: "connected",
        providerItemRecordId: provider.id,
        providerItemId: provider.providerItemId,
        syncState: "current",
        lastSyncedAt: stamp,
      })
      .where(eq(financeAccounts.id, primary.accountId));
    expect(
      (await f.service.qualify({ decisions: [f.decision] }, f.agentContext)).items[0]?.state,
    ).toBe("eligible");
    await database.db
      .update(financeProviderItems)
      .set({ lastSyncedAt: new Date("2026-10-20T00:00:00Z") })
      .where(eq(financeProviderItems.id, provider.id));
    expect(
      (await f.service.qualify({ decisions: [f.decision] }, f.agentContext)).items[0],
    ).toMatchObject({ state: "source_blocked", reasons: ["source_not_current"] });
    await database.db
      .update(financeProviderItems)
      .set({ lastSyncedAt: stamp })
      .where(eq(financeProviderItems.id, provider.id));
    await database.db
      .update(financeAccounts)
      .set({ syncState: "stale" })
      .where(eq(financeAccounts.id, primary.accountId));
    expect(
      (await f.service.qualify({ decisions: [f.decision] }, f.agentContext)).items[0]?.state,
    ).toBe("source_blocked");
  });
  it.each([
    "pending",
    "currency",
  ] as const)("retains unknown or pending %s source evidence", async (field) => {
    const f = await qualifyFixture();
    await database.db
      .update(financeTransactions)
      .set(field === "pending" ? { pending: true } : { currencyCode: null })
      .where(eq(financeTransactions.id, f.decision.transactionId));
    expect(
      (await f.service.qualify({ decisions: [f.decision] }, f.agentContext)).items[0]?.state,
    ).toBe("source_blocked");
  });
  it("keeps execution denial distinct from source failure and standing approval", async () => {
    const f = await qualifyFixture();
    const reader = await agent(f.userId, false);
    expect((await f.service.qualify({ decisions: [f.decision] }, reader)).items[0]).toMatchObject({
      state: "authorization_denied",
      reasons: ["execution_not_authorized"],
    });
    await database.db
      .update(executionPolicySettings)
      .set({ reviewBypassEnabled: false })
      .where(eq(executionPolicySettings.userId, f.userId));
    expect(
      (await f.service.qualify({ decisions: [f.decision] }, f.agentContext)).items[0],
    ).toMatchObject({ state: "awaiting_approval", reasons: ["approval_required"] });
    await database.db
      .update(accessTokens)
      .set({ revokedAt: now() })
      .where(eq(accessTokens.id, f.agentContext.principal.actorId));
    await expect(
      f.service.qualify({ decisions: [f.decision] }, f.agentContext),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
  it("does not resolve repeated same-amount transfer ambiguity by selecting a preferred date", async () => {
    const f = await qualifyFixture();
    await database.db.insert(financeTransactions).values({
      userId: f.userId,
      accountId: f.counterpart.accountId,
      merchant: "Internal movement",
      amount: 1500,
      direction: "transfer",
      providerDirection: "income",
      providerCategory: "TRANSFER_IN",
      currencyCode: "USD",
      transactionDate: "2026-10-25",
    });
    const result = await f.service.qualify({ decisions: [f.decision] }, f.agentContext);
    expect(result.items[0]).toMatchObject({
      state: "awaiting_evidence",
      reasons: ["decision_evidence_not_qualified"],
    });
  });
  it("does not use qualification as a capability after the source revision changes", async () => {
    const f = await qualifyFixture();
    expect(
      (await f.service.qualify({ decisions: [f.decision] }, f.agentContext)).items[0]?.state,
    ).toBe("eligible");
    await database.db
      .update(financeTransactions)
      .set({ merchant: "Changed source" })
      .where(eq(financeTransactions.id, f.decision.transactionId));
    await expect(
      f.service.preview({ idempotencyKey: randomUUID(), decisions: [f.decision] }, f.agentContext),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("retains uncertainty when the bounded owner-wide counterpart scan is incomplete", async () => {
    const f = await qualifyFixture();
    await database.db.insert(financeTransactions).values(
      Array.from({ length: 199 }, () => ({
        userId: f.userId,
        accountId: f.counterpart.accountId,
        merchant: "Unrelated same amount",
        amount: 1500,
        direction: "expense" as const,
        transactionDate: "2026-01-01",
      })),
    );
    expect(
      (await f.service.qualify({ decisions: [f.decision] }, f.agentContext)).items[0],
    ).toMatchObject({ state: "awaiting_evidence", reasons: ["counterpart_evidence_limit"] });
  });
  it.each([
    "revision",
    "replacement",
    "legacy",
  ] as const)("requires a new preview after counterpart %s without blocking independent decisions", async (scenario) => {
    const f = await transferFixture();
    const run = await f.service.preview(f.input, f.agentContext);
    const before = await transaction(f.decision.transactionId);
    expect(run.transferCounterparts).toEqual([
      {
        index: 0,
        transactionId: f.counterpart.id,
        revision: f.counterpart.contextualRevision.toString(),
      },
    ]);
    if (scenario === "revision") {
      const stored = required(
        await database.db.query.financeReviewBatchRuns.findFirst({
          where: eq(financeReviewBatchRuns.id, run.id),
        }),
      );
      expect(validateFinanceCompletionBatch(f.userId, stored, run.fingerprint).manifest).toEqual(
        run.decisions,
      );
      const { index, transactionId } = required(run.transferCounterparts[0]);
      const alteredManifest = stored.manifest.map((entry, position) =>
        position === index
          ? {
              decision: required(run.decisions[index]),
              transferCounterpart: {
                transactionId,
                revision: (f.counterpart.contextualRevision + 1n).toString(),
              },
            }
          : entry,
      );
      expect(() =>
        validateFinanceCompletionBatch(
          f.userId,
          { ...stored, manifest: alteredManifest },
          run.fingerprint,
        ),
      ).toThrow("The saved Finance batch source is inconsistent.");

      await database.db
        .update(financeTransactions)
        .set({ merchant: "Updated source merchant" })
        .where(eq(financeTransactions.id, f.counterpart.id));
    } else if (scenario === "replacement") {
      await database.db
        .update(financeTransactions)
        .set({ pending: true })
        .where(eq(financeTransactions.id, f.counterpart.id));
      await database.db.insert(financeTransactions).values({
        userId: f.userId,
        accountId: f.counterpart.accountId,
        merchant: "Replacement source entry",
        amount: f.counterpart.amount,
        direction: "transfer",
        providerDirection: "income",
        providerCategory: "TRANSFER_IN",
        currencyCode: "USD",
        transactionDate: f.counterpart.transactionDate,
      });
    } else {
      await database.db
        .update(financeReviewBatchRuns)
        .set({ manifest: run.decisions })
        .where(eq(financeReviewBatchRuns.id, run.id));
    }
    const replay = await f.service.preview(f.input, f.agentContext);
    expect(replay.fingerprint).toBe(run.fingerprint);
    expect(replay.transferCounterparts).toEqual(
      scenario === "legacy" ? [] : run.transferCounterparts,
    );
    const fresh = await f.service.preview(
      { ...f.input, idempotencyKey: "fresh-counterpart" },
      f.agentContext,
    );
    if (scenario !== "legacy") expect(fresh.fingerprint).not.toBe(run.fingerprint);
    const result = await f.service.execute(
      run.id,
      { fingerprint: run.fingerprint },
      scenario === "legacy" ? f.context : f.agentContext,
    );
    expect(result.outcomes).toMatchObject([
      { status: "failed", recovery: "new_preview", error: { code: "conflict" } },
      { status: "deferred" },
    ]);
    expect(await transaction(f.decision.transactionId)).toEqual(before);
  });
  it.each([
    "confirm_transfer",
    "recategorize",
  ] as const)("executes an exact agent %s with the real writer and continues the batch", async (action) => {
    const f = await transferFixture(action);
    const siblingId = randomUUID();
    await database.db.insert(financeReviewCases).values({
      id: siblingId,
      userId: f.userId,
      transactionId: f.decision.transactionId,
      reason: "possible_reimbursement",
      updatedAt: stamp,
    });
    const siblingBefore = await database.db.query.financeReviewCases.findFirst({
      where: eq(financeReviewCases.id, siblingId),
    });
    const run = await f.service.preview(f.input, f.agentContext);
    const result = await f.service.execute(
      run.id,
      { fingerprint: run.fingerprint },
      f.agentContext,
    );
    expect(result.outcomes.map((outcome) => outcome.status)).toEqual(["applied", "deferred"]);
    expect(result.pendingCount).toBe(0);
    expect(await transaction(f.decision.transactionId)).toMatchObject({
      direction: action === "confirm_transfer" ? "transfer" : "expense",
      reconciliationStatus: action === "confirm_transfer" ? "confirmed" : "not_applicable",
      category: action === "confirm_transfer" ? "Transfers" : "Food",
      needsReview: true,
    });
    expect(await transaction(f.counterpart.id)).toEqual(f.counterpart);
    expect(
      await database.db.query.financeReviewCases.findFirst({
        where: eq(financeReviewCases.id, siblingId),
      }),
    ).toEqual(siblingBefore);
    expect(
      await database.db.query.financeReviewCases.findFirst({
        where: eq(financeReviewCases.id, f.decision.reviewId),
      }),
    ).toMatchObject({ status: "resolved" });
    const audits = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.userId, f.userId));
    expect(audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action:
            action === "confirm_transfer"
              ? "finance.transfer_confirmed"
              : "finance.transaction_categorized",
          actorType: "agent",
          actorId: f.agentContext.principal.actorId,
          entityId: f.decision.transactionId,
        }),
      ]),
    );
    expect(
      await f.service.execute(run.id, { fingerprint: run.fingerprint }, f.agentContext),
    ).toEqual(result);
    expect(
      await database.db
        .select()
        .from(financeClassificationDecisions)
        .where(eq(financeClassificationDecisions.userId, f.userId)),
    ).toHaveLength(1);
  });
  async function twoLegTransferFixture() {
    const f = await transferFixture();
    await database.db
      .update(financeTransactions)
      .set({ needsReview: true })
      .where(eq(financeTransactions.id, f.counterpart.id));
    const counterpart = required(await transaction(f.counterpart.id));
    const [review] = await database.db
      .insert(financeReviewCases)
      .values({
        userId: f.userId,
        transactionId: counterpart.id,
        reason: "possible_transfer",
        updatedAt: stamp,
      })
      .returning();
    const second: FinanceReviewBatchDecision = {
      ...f.decision,
      transactionId: counterpart.id,
      expectedTransactionUpdatedAt: counterpart.updatedAt.toISOString(),
      expectedTransactionRevision: counterpart.contextualRevision.toString(),
      reviewId: required(review).id,
      expectedReviewRevision: "1",
      expectedActionRevision: "0",
    };
    const siblings = await database.db
      .insert(financeReviewCases)
      .values([
        {
          userId: f.userId,
          transactionId: f.decision.transactionId,
          reason: "possible_duplicate" as const,
          updatedAt: stamp,
        },
        {
          userId: f.userId,
          transactionId: counterpart.id,
          reason: "possible_reimbursement" as const,
          updatedAt: stamp,
        },
      ])
      .returning();
    f.decisions.splice(1, 0, second);
    return { ...f, counterpart, second, siblings };
  }
  it("does not inherit a counterpart revision advance committed by a different batch", async () => {
    const f = await twoLegTransferFixture();
    const pending = await f.service.preview(
      { idempotencyKey: randomUUID(), decisions: [f.second] },
      f.agentContext,
    );
    const first = await f.service.preview(
      { idempotencyKey: randomUUID(), decisions: [f.decision] },
      f.agentContext,
    );
    expect(
      (await f.service.execute(first.id, { fingerprint: first.fingerprint }, f.agentContext))
        .outcomes[0]?.status,
    ).toBe("applied");
    const result = await f.service.execute(
      pending.id,
      { fingerprint: pending.fingerprint },
      f.agentContext,
    );
    expect(result.outcomes[0]).toMatchObject({
      status: "failed",
      recovery: "new_preview",
      error: { code: "conflict" },
    });
    expect(await transaction(f.second.transactionId)).toEqual(f.counterpart);
  });
  it.each([
    "same batch",
    "resumed chunk",
    "owner resumes agent preview",
    "fresh preview",
  ] as const)("confirms both exact transfer legs through %s without consuming unrelated cases", async (mode) => {
    const f = await twoLegTransferFixture();
    const run = await f.service.preview(
      { ...f.input, decisions: mode === "fresh preview" ? [f.decision] : f.decisions },
      f.agentContext,
    );
    const first = await f.service.execute(
      run.id,
      { fingerprint: run.fingerprint, limit: mode === "same batch" ? 10 : 1 },
      f.agentContext,
    );
    if (mode !== "same batch") {
      expect(first.outcomes.map((outcome) => outcome.status)).toEqual(["applied"]);
      expect(await transaction(f.counterpart.id)).toEqual(f.counterpart);
      expect(
        await database.db.query.financeReviewCases.findFirst({
          where: eq(financeReviewCases.id, f.second.reviewId),
        }),
      ).toMatchObject({ status: "open" });
    }
    const freshService = createFinanceReviewBatchService({
      db: database.db,
      now,
      finance: f.finance,
    });
    const resumedRun =
      mode === "fresh preview"
        ? await freshService.preview(
            { idempotencyKey: randomUUID(), decisions: [f.second, f.following] },
            f.agentContext,
          )
        : run;
    const result = await freshService.execute(
      resumedRun.id,
      { fingerprint: resumedRun.fingerprint },
      mode === "owner resumes agent preview" ? f.context : f.agentContext,
    );
    expect(result.pendingCount).toBe(0);
    expect(result.outcomes.map((outcome) => outcome.status)).toEqual(
      mode === "fresh preview" ? ["applied", "deferred"] : ["applied", "applied", "deferred"],
    );
    for (const decision of [f.decision, f.second]) {
      expect(await transaction(decision.transactionId)).toMatchObject({
        direction: "transfer",
        reconciliationStatus: "confirmed",
        needsReview: true,
      });
      expect(
        await database.db.query.financeReviewCases.findFirst({
          where: eq(financeReviewCases.id, decision.reviewId),
        }),
      ).toMatchObject({ status: "resolved" });
    }
    for (const sibling of f.siblings)
      expect(
        await database.db.query.financeReviewCases.findFirst({
          where: eq(financeReviewCases.id, sibling.id),
        }),
      ).toEqual(sibling);
    expect(
      await freshService.execute(
        resumedRun.id,
        { fingerprint: resumedRun.fingerprint },
        f.agentContext,
      ),
    ).toEqual(result);
    expect(
      await database.db
        .select()
        .from(financeClassificationDecisions)
        .where(eq(financeClassificationDecisions.userId, f.userId)),
    ).toHaveLength(2);
    const audits = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.userId, f.userId));
    const confirmations = audits.filter((event) => event.action === "finance.transfer_confirmed");
    expect(confirmations).toHaveLength(2);
    expect(confirmations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityId: f.decision.transactionId,
          after: expect.objectContaining({
            confirmedTransferPair: {
              transactionRevision: (BigInt(f.decision.expectedTransactionRevision) + 1n).toString(),
              counterpartTransactionId: f.second.transactionId,
              counterpartRevision: f.second.expectedTransactionRevision,
            },
          }),
        }),
      ]),
    );
  });
  it("does not reuse a reserved counterpart for a third transaction after first-leg confirmation", async () => {
    const f = await twoLegTransferFixture();
    const original = required(await transaction(f.decision.transactionId));
    const run = await f.service.preview({ ...f.input, decisions: [f.decision] }, f.agentContext);
    await f.service.execute(run.id, { fingerprint: run.fingerprint }, f.agentContext);
    const thirdId = randomUUID();
    const [thirdTransaction] = await database.db
      .insert(financeTransactions)
      .values({ ...original, id: thirdId, contextualRevision: 1n })
      .returning();
    const [thirdReview] = await database.db
      .insert(financeReviewCases)
      .values({
        userId: f.userId,
        transactionId: thirdId,
        reason: "possible_transfer",
        updatedAt: stamp,
      })
      .returning();
    const third = {
      ...f.decision,
      transactionId: thirdId,
      expectedTransactionRevision: required(thirdTransaction).contextualRevision.toString(),
      reviewId: required(thirdReview).id,
      expectedReviewRevision: "1",
    };
    await expect(
      f.service.preview({ idempotencyKey: randomUUID(), decisions: [third] }, f.agentContext),
    ).rejects.toMatchObject({
      code: "invalid_request",
      message:
        "Confirming this transfer requires a unique owned counterpart with current source evidence.",
    });
    // The original second leg must also retain reciprocal uniqueness when a new
    // ambiguous candidate appears, even though its confirmed partner is bound.
    await expect(
      f.service.preview({ idempotencyKey: randomUUID(), decisions: [f.second] }, f.agentContext),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(await transaction(f.counterpart.id)).toEqual(f.counterpart);
  });
  it.each([
    "confirmed source",
    "pending partner",
  ] as const)("rejects stale exact-pair receipts after editing the %s", async (changed) => {
    const f = await twoLegTransferFixture();
    const run = await f.service.preview({ ...f.input, decisions: [f.decision] }, f.agentContext);
    await f.service.execute(run.id, { fingerprint: run.fingerprint }, f.agentContext);
    const id = changed === "confirmed source" ? f.decision.transactionId : f.second.transactionId;
    await database.db
      .update(financeTransactions)
      .set({ notes: "New evidence after confirmation" })
      .where(eq(financeTransactions.id, id));
    const current = required(await transaction(f.second.transactionId));
    await expect(
      f.service.preview(
        {
          idempotencyKey: randomUUID(),
          decisions: [
            { ...f.second, expectedTransactionRevision: current.contextualRevision.toString() },
          ],
        },
        f.agentContext,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(
      await database.db.query.financeReviewCases.findFirst({
        where: eq(financeReviewCases.id, f.second.reviewId),
      }),
    ).toMatchObject({ status: "open" });
  });
  it.each([
    null,
    { confirmedTransferPair: "legacy confirmation" },
    { confirmedTransferPair: {} },
    { confirmedTransferPair: { transactionRevision: 1 } },
    { confirmedTransferPair: { transactionRevision: "1" } },
    { confirmedTransferPair: { transactionRevision: "1", counterpartTransactionId: 1 } },
    { confirmedTransferPair: { transactionRevision: "1", counterpartTransactionId: "missing" } },
    {
      confirmedTransferPair: {
        transactionRevision: "1",
        counterpartTransactionId: "missing",
        counterpartRevision: 1,
      },
    },
  ])("does not use a legacy or incomplete confirmation receipt as exact-pair authority: %j", async (after) => {
    const f = await twoLegTransferFixture();
    await database.db
      .update(financeTransactions)
      .set({ reconciliationStatus: "confirmed" })
      .where(eq(financeTransactions.id, f.decision.transactionId));
    await database.db.insert(auditEvents).values({
      userId: f.userId,
      actorId: f.userId,
      actorType: "user",
      requestId: randomUUID(),
      action: "finance.transfer_confirmed",
      entityType: "finance_transaction",
      entityId: f.decision.transactionId,
      after,
    });
    await expect(
      f.service.preview({ idempotencyKey: randomUUID(), decisions: [f.second] }, f.agentContext),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(await transaction(f.counterpart.id)).toEqual(f.counterpart);
    expect(
      await database.db.query.financeReviewCases.findFirst({
        where: eq(financeReviewCases.id, f.second.reviewId),
      }),
    ).toMatchObject({ status: "open" });
  });
  it.each([
    "confirm ordinary",
    "approve transfer",
    "existing relationship",
  ] as const)("rejects a decision outside its exact transfer authority: %s", async (scenario) => {
    const f = await transferFixture();
    if (scenario === "confirm ordinary") f.following.action = "confirm_transfer";
    else if (scenario === "approve transfer") f.decision.action = "approve";
    else {
      await database.db
        .update(financeTransactions)
        .set({ transferGroupId: randomUUID() })
        .where(eq(financeTransactions.id, f.decision.transactionId));
      f.decision.expectedTransactionRevision = required(
        await transaction(f.decision.transactionId),
      ).contextualRevision.toString();
    }
    await expect(
      f.service.preview(
        { ...f.input, decisions: [scenario === "confirm ordinary" ? f.following : f.decision] },
        f.agentContext,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(await f.service.list(f.agentContext)).toEqual([]);
    expect(
      await database.db.query.financeReviewCases.findFirst({
        where: eq(financeReviewCases.id, f.decision.reviewId),
      }),
    ).toMatchObject({ status: "open" });
  });
  it("records a deleted review as a failed item and still processes the next exact case", async () => {
    const f = await fixture(2, true);
    const first = required(f.decisions[0]);
    const second = required(f.decisions[1]);
    if (first.kind !== "review" || second.kind !== "review") throw new Error("fixture");
    second.action = "defer";
    const run = await f.service.preview(f.input, f.context);
    await database.db.delete(financeReviewCases).where(eq(financeReviewCases.id, first.reviewId));
    const result = await f.service.execute(run.id, { fingerprint: run.fingerprint }, f.context);
    expect(result.outcomes.map((item) => item.status)).toEqual(["failed", "deferred"]);
    expect(result.outcomes[0]).toMatchObject({
      error: { code: "not_found" },
      recovery: "new_preview",
    });
    expect((await transaction(first.transactionId))?.needsReview).toBe(true);
  });
  it.each([
    "finances:read",
    "finances:write",
  ] as const)("requires the caller's %s scope even when its persisted grant is broader", async (missing) => {
    const f = await fixture();
    const context = await agent(f.userId);
    const run = await f.service.preview(f.input, context);
    context.principal.scopes = new Set(
      [...context.principal.scopes].filter((scope) => scope !== missing),
    );
    await expect(
      f.service.execute(run.id, { fingerprint: run.fingerprint }, context),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect((await f.service.get(run.id, f.context)).outcomes).toEqual([]);
    expect((await transaction(required(f.decisions[0]).transactionId))?.needsReview).toBe(true);
  });
  it.each([
    "currency",
    "direction",
    "pending",
    "amount",
    "date",
    "account",
    "owner",
    "provenance",
    "ambiguous",
  ] as const)("rejects unsupported transfer counterpart evidence: %s", async (change) => {
    const f = await transferFixture();
    const target = required(await transaction(f.decision.transactionId));
    if (change === "ambiguous") {
      await database.db.insert(financeTransactions).values({ ...f.counterpart, id: randomUUID() });
    } else {
      const other = change === "owner" ? await fixture() : null;
      await database.db
        .update(financeTransactions)
        .set({
          ...(change === "currency" ? { currencyCode: "EUR" } : {}),
          ...(change === "direction" ? { providerDirection: "expense" as const } : {}),
          ...(change === "pending" ? { pending: true } : {}),
          ...(change === "amount" ? { amount: 1400 } : {}),
          ...(change === "date" ? { transactionDate: "2026-09-01" } : {}),
          ...(change === "account" ? { accountId: target.accountId } : {}),
          ...(other ? { userId: other.userId } : {}),
          ...(change === "provenance"
            ? { direction: "income" as const, providerCategory: null }
            : {}),
        })
        .where(eq(financeTransactions.id, f.counterpart.id));
    }
    await expect(f.service.preview(f.input, f.agentContext)).rejects.toMatchObject({
      code: "invalid_request",
    });
    expect((await transaction(target.id))?.reconciliationStatus).toBe("candidate");
  });
  it("records changed counterpart evidence as an item failure and continues without closing cases", async () => {
    const f = await transferFixture();
    const run = await f.service.preview(f.input, f.agentContext);
    await database.db
      .update(financeTransactions)
      .set({ currencyCode: "EUR" })
      .where(eq(financeTransactions.id, f.counterpart.id));
    const result = await f.service.execute(
      run.id,
      { fingerprint: run.fingerprint },
      f.agentContext,
    );
    expect(result.outcomes.map((outcome) => outcome.status)).toEqual(["failed", "deferred"]);
    expect(result.outcomes[0]).toMatchObject({
      error: { code: "invalid_request" },
      recovery: "new_preview",
    });
    expect((await transaction(f.decision.transactionId))?.reconciliationStatus).toBe("candidate");
    expect(
      await database.db.query.financeReviewCases.findFirst({
        where: eq(financeReviewCases.id, f.decision.reviewId),
      }),
    ).toMatchObject({ status: "open" });
  });
  it("stops admitting slow items before the request deadline and resumes committed receipts once", async () => {
    const f = await fixture(3);
    const run = await f.service.preview(f.input, f.context);
    let elapsed = 0;
    let calls = 0;
    const slow = createFinanceReviewBatchService({
      db: database.db,
      now,
      elapsedNow: () => elapsed,
      finance: {
        ...f.finance,
        async applyCategorizations(...args) {
          calls++;
          const result = await f.finance.applyCategorizations(...args);
          elapsed += 21_000;
          return result;
        },
      },
    });
    const partial = await slow.execute(run.id, { fingerprint: run.fingerprint }, f.context);
    expect(calls).toBe(2);
    expect(partial).toMatchObject({ status: "in_progress", pendingCount: 1 });
    expect(partial.outcomes.map((outcome) => outcome.status)).toEqual(["applied", "applied"]);
    const completed = await f.service.execute(run.id, { fingerprint: run.fingerprint }, f.context);
    expect(completed).toMatchObject({ status: "completed", pendingCount: 0 });
    expect(
      await database.db
        .select()
        .from(financeClassificationDecisions)
        .where(eq(financeClassificationDecisions.userId, f.userId)),
    ).toHaveLength(3);
  });
  it.each([
    "deadline",
    "disconnect",
  ] as const)("rolls back the current item on %s and resumes pending work", async (reason) => {
    const f = await fixture(2);
    const run = await f.service.preview(f.input, f.context);
    const abort = new AbortController();
    let elapsed = 0;
    let calls = 0;
    let writerFinished!: () => void;
    const finished = new Promise<void>((resolve) => {
      writerFinished = resolve;
    });
    const slow = createFinanceReviewBatchService({
      db: database.db,
      now,
      elapsedNow: () => elapsed,
      finance: {
        ...f.finance,
        async applyCategorizations(...args) {
          calls++;
          const result = await f.finance.applyCategorizations(...args);
          if (reason === "deadline") elapsed = 45_001;
          else abort.abort();
          writerFinished();
          return result;
        },
      },
    });
    const partial = await slow.execute(
      run.id,
      { fingerprint: run.fingerprint },
      { ...f.context, signal: abort.signal },
    );
    await finished;
    expect(calls).toBe(1);
    expect(partial).toMatchObject({ status: "previewed", pendingCount: 2, outcomes: [] });
    // The owner lock makes resume wait for the interrupted transaction's rollback.
    const completed = await f.service.execute(run.id, { fingerprint: run.fingerprint }, f.context);
    expect(completed.status).toBe("completed");
    expect(
      await database.db
        .select()
        .from(financeClassificationDecisions)
        .where(eq(financeClassificationDecisions.userId, f.userId)),
    ).toHaveLength(2);
  });
  // Faults wrap only the pg transport boundary; transactions and writers remain real.
  function withSessionFault(
    isolated: DatabaseClient,
    intercept: (query: unknown, proceed: () => unknown) => unknown,
  ) {
    const wrapped = new WeakSet<PoolClient>();
    const pool = new Proxy(isolated.pool, {
      get(target, key, receiver) {
        if (key !== "connect") return Reflect.get(target, key, receiver);
        return async () => {
          const client = await target.connect();
          if (!wrapped.has(client)) {
            wrapped.add(client);
            client.query = new Proxy(client.query, {
              apply(query, receiver, args) {
                return intercept(args[0], () => Reflect.apply(query, receiver, args));
              },
            });
          }
          return client;
        };
      },
    });
    return new Proxy(isolated.db, {
      get(target, key, receiver) {
        return key === "$client" ? pool : Reflect.get(target, key, receiver);
      },
    });
  }
  function sessionQueryText(query: unknown) {
    return typeof query === "string"
      ? query
      : query && typeof query === "object" && "text" in query
        ? String(query.text)
        : "";
  }
  it.each([
    "read",
    "missing",
    "set",
    "primitive",
  ] as const)("fails closed and discards the checkout when session deadline setup fails: %s", async (failure) => {
    const f = await fixture();
    const run = await f.service.preview(f.input, f.context);
    const isolated = createDatabaseClient({
      connectionString: container.getConnectionUri(),
      max: 1,
    });
    try {
      const original = await isolated.pool.query("SELECT pg_backend_pid() AS pid");
      const fault = new Error("Session configuration unavailable");
      let intercepted = false;
      const db = withSessionFault(isolated, (query, proceed) => {
        const text = sessionQueryText(query);
        const matches =
          failure === "set" ? text.includes("set_config") : text.includes("current_setting");
        if (!intercepted && matches) {
          intercepted = true;
          if (failure === "missing") return Promise.resolve({ rows: [] });
          return Promise.reject(failure === "primitive" ? "connection lost" : fault);
        }
        return proceed();
      });
      const service = createFinanceReviewBatchService({ db, now, finance: f.finance });
      const execution = service.execute(run.id, { fingerprint: run.fingerprint }, f.context);
      if (failure === "missing")
        await expect(execution).rejects.toMatchObject({ code: "internal_error" });
      else
        await expect(execution).rejects.toBe(failure === "primitive" ? "connection lost" : fault);
      expect(intercepted).toBe(true);
      const recovered = await isolated.pool.query(
        "SELECT pg_backend_pid() AS pid, current_setting('transaction_timeout') AS timeout",
      );
      expect(recovered.rows[0]?.pid).not.toBe(original.rows[0]?.pid);
      expect(recovered.rows[0]?.timeout).toBe("0");
      expect((await f.service.get(run.id, f.context)).outcomes).toEqual([]);
      expect((await transaction(required(f.decisions[0]).transactionId))?.needsReview).toBe(true);
      expect(
        (await f.service.execute(run.id, { fingerprint: run.fingerprint }, f.context)).status,
      ).toBe("completed");
    } finally {
      await isolated.close();
    }
  });
  it("keeps committed receipts truthful when restoring the session deadline fails", async () => {
    const f = await fixture();
    const run = await f.service.preview(f.input, f.context);
    const isolated = createDatabaseClient({
      connectionString: container.getConnectionUri(),
      max: 1,
    });
    try {
      const original = await isolated.pool.query("SELECT pg_backend_pid() AS pid");
      let written = false;
      let resetFailed = false;
      const db = withSessionFault(isolated, (query, proceed) => {
        if (written && !resetFailed && sessionQueryText(query).includes("set_config")) {
          resetFailed = true;
          return Promise.reject(new Error("Connection lost during post-commit reset"));
        }
        return proceed();
      });
      const service = createFinanceReviewBatchService({
        db,
        now,
        finance: {
          ...f.finance,
          async applyCategorizations(...args) {
            const result = await f.finance.applyCategorizations(...args);
            written = true;
            return result;
          },
        },
      });
      const completed = await service.execute(run.id, { fingerprint: run.fingerprint }, f.context);
      expect(resetFailed).toBe(true);
      expect(completed).toMatchObject({ status: "completed", pendingCount: 0 });
      expect(await f.service.get(run.id, f.context)).toEqual(completed);
      const recovered = await isolated.pool.query(
        "SELECT pg_backend_pid() AS pid, current_setting('transaction_timeout') AS timeout",
      );
      expect(recovered.rows[0]?.pid).not.toBe(original.rows[0]?.pid);
      expect(recovered.rows[0]?.timeout).toBe("0");
      expect(await f.service.execute(run.id, { fingerprint: run.fingerprint }, f.context)).toEqual(
        completed,
      );
      expect(
        await database.db
          .select()
          .from(financeClassificationDecisions)
          .where(eq(financeClassificationDecisions.userId, f.userId)),
      ).toHaveLength(1);
    } finally {
      await isolated.close();
    }
  });
  it("rolls back real writer effects when the writer omits its required outcome", async () => {
    const f = await fixture();
    const run = await f.service.preview(f.input, f.context);
    const service = createFinanceReviewBatchService({
      db: database.db,
      now,
      finance: {
        ...f.finance,
        async applyCategorizations(...args) {
          await f.finance.applyCategorizations(...args);
          return [];
        },
      },
    });
    await expect(
      service.execute(run.id, { fingerprint: run.fingerprint }, f.context),
    ).rejects.toMatchObject({
      code: "internal_error",
      message: "The categorization outcome is missing.",
    });
    expect((await f.service.get(run.id, f.context)).outcomes).toEqual([]);
    expect((await transaction(required(f.decisions[0]).transactionId))?.needsReview).toBe(true);
    expect(
      await database.db.select().from(auditEvents).where(eq(auditEvents.userId, f.userId)),
    ).toHaveLength(0);
    expect(
      (await f.service.execute(run.id, { fingerprint: run.fingerprint }, f.context)).status,
    ).toBe("completed");
  });
  it("restores the checked-out session's timeout without changing unrelated pool settings", async () => {
    const f = await fixture();
    const run = await f.service.preview(f.input, f.context);
    const isolated = createDatabaseClient({
      connectionString: container.getConnectionUri(),
      max: 1,
    });
    try {
      await isolated.pool.query("SET transaction_timeout = '17s'");
      await isolated.pool.query("SET statement_timeout = '19s'");
      await isolated.pool.query("SET lock_timeout = '23s'");
      const settingsSql =
        "SELECT pg_backend_pid() AS pid, current_setting('transaction_timeout') AS transaction_timeout, current_setting('statement_timeout') AS statement_timeout, current_setting('lock_timeout') AS lock_timeout";
      const before = await isolated.pool.query(settingsSql);
      const service = createFinanceReviewBatchService({
        db: isolated.db,
        now,
        finance: f.finance,
        transactionBudgetMs: 1_000,
      });
      expect(
        (await service.execute(run.id, { fingerprint: run.fingerprint }, f.context)).status,
      ).toBe("completed");
      expect((await isolated.pool.query(settingsSql)).rows).toEqual(before.rows);
    } finally {
      await isolated.close();
    }
  });
  it("recovers a real PostgreSQL transaction_timeout despite rollback masking 25P04", async () => {
    const f = await fixture(3);
    const run = await f.service.preview(f.input, f.context);
    const isolated = createDatabaseClient({
      connectionString: container.getConnectionUri(),
      max: 1,
    });
    try {
      const initialSession = await isolated.pool.query("SELECT pg_backend_pid() AS pid");
      let calls = 0;
      let observedCode: unknown;
      let rollbackFailure: unknown;
      const slow = createFinanceReviewBatchService({
        db: isolated.db,
        now,
        transactionBudgetMs: 3_000,
        finance: {
          ...f.finance,
          async applyCategorizations(...args) {
            calls++;
            const result = await f.finance.applyCategorizations(...args);
            if (calls === 2) {
              const tx = required(args[2]);
              // Use the production pre-BEGIN session setup. Every statement stays
              // below its 1500ms statement timeout, but the sequence crosses the
              // real 3s server transaction deadline after real writer effects.
              // Allow normal writer/setup work room under parallel DB suites.
              try {
                for (let step = 0; step < 60; step++) await tx.execute(sql`SELECT pg_sleep(0.1)`);
              } catch (error) {
                let cause: unknown = error;
                while (typeof cause === "object" && cause !== null) {
                  if ("code" in cause) {
                    observedCode = cause.code;
                    break;
                  }
                  cause = "cause" in cause ? cause.cause : null;
                }
                try {
                  await tx.execute(sql`rollback to savepoint sp1`);
                } catch (rollbackError) {
                  rollbackFailure = rollbackError;
                }
                throw error;
              }
              throw new Error("PostgreSQL did not enforce the transaction timeout");
            }
            return result;
          },
        },
      });
      const partial = await slow.execute(run.id, { fingerprint: run.fingerprint }, f.context);
      expect(calls, JSON.stringify(partial)).toBe(2);
      expect(observedCode).toBe("25P04");
      const recoveredSession = await isolated.pool.query(
        "SELECT pg_backend_pid() AS pid, current_setting('transaction_timeout') AS timeout",
      );
      expect(recoveredSession.rows[0]?.pid).not.toBe(initialSession.rows[0]?.pid);
      expect(recoveredSession.rows[0]?.timeout).toBe("0");
      // A real rollback on the terminated session fails too; Drizzle performs
      // the same rollback internally, which must not hide the observed 25P04.
      expect(rollbackFailure).toMatchObject({ query: "rollback to savepoint sp1" });
      expect(calls).toBe(2);
      expect(partial).toMatchObject({ status: "in_progress", pendingCount: 2 });
      expect(partial.outcomes).toEqual([expect.objectContaining({ index: 0, status: "applied" })]);
      // Read durable state on a new transaction/connection: no optimistic receipt or
      // classification/audit from the terminated writer may survive.
      expect(await f.service.get(run.id, f.context)).toEqual(partial);
      for (const [index, decision] of f.decisions.entries())
        expect((await transaction(decision.transactionId))?.needsReview).toBe(index !== 0);
      const classifications = () =>
        database.db
          .select()
          .from(financeClassificationDecisions)
          .where(eq(financeClassificationDecisions.userId, f.userId));
      const audits = () =>
        database.db.select().from(auditEvents).where(eq(auditEvents.userId, f.userId));
      expect(await classifications()).toEqual([
        expect.objectContaining({ transactionId: required(f.decisions[0]).transactionId }),
      ]);
      expect(await audits()).toEqual([
        expect.objectContaining({
          entityId: required(f.decisions[0]).transactionId,
          action: "finance.transaction_categorized",
        }),
      ]);
      const resumed = createFinanceReviewBatchService({ db: database.db, now, finance: f.finance });
      const completed = await resumed.execute(run.id, { fingerprint: run.fingerprint }, f.context);
      expect(completed).toMatchObject({ status: "completed", pendingCount: 0 });
      expect(completed.outcomes.map((outcome) => outcome.status)).toEqual([
        "applied",
        "applied",
        "applied",
      ]);
      expect(await resumed.execute(run.id, { fingerprint: run.fingerprint }, f.context)).toEqual(
        completed,
      );
      expect(await classifications()).toHaveLength(3);
      expect(await audits()).toHaveLength(3);
    } finally {
      await isolated.close();
    }
  });
  it.each([
    "deadline",
    "disconnect",
  ] as const)("discards a late pool checkout after %s without starting work", async (reason) => {
    const f = await fixture();
    const run = await f.service.preview(f.input, f.context);
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let acquisition: Promise<PoolClient> | undefined;
    let discarded = false;
    const controller = new AbortController();
    const delayedPool = new Proxy(database.pool, {
      get(target, key) {
        if (key !== "connect") return Reflect.get(target, key);
        return () => {
          acquisition = hold.then(async () => {
            const client = await target.connect();
            const releaseClient = client.release.bind(client);
            client.release = (destroy) => {
              discarded = destroy === true;
              releaseClient(destroy);
            };
            return client;
          });
          return acquisition;
        };
      },
    });
    const delayedDb = new Proxy(database.db, {
      get(target, key, receiver) {
        return key === "$client" ? delayedPool : Reflect.get(target, key, receiver);
      },
    });
    const bounded = createFinanceReviewBatchService({
      db: delayedDb,
      now,
      finance: f.finance,
      executionBudgetMs: reason === "deadline" ? 20 : 45_000,
    });
    const execution = bounded.execute(
      run.id,
      { fingerprint: run.fingerprint },
      { ...f.context, signal: controller.signal },
    );
    if (reason === "disconnect") controller.abort();
    await expect(execution).rejects.toMatchObject({ code: "service_unavailable" });
    release();
    await acquisition;
    // The delayed checkout is released/discarded without starting a transaction.
    expect(discarded).toBe(true);
    expect((await f.service.get(run.id, f.context)).outcomes).toEqual([]);
    expect((await transaction(required(f.decisions[0]).transactionId))?.needsReview).toBe(true);
    expect(
      (await f.service.execute(run.id, { fingerprint: run.fingerprint }, f.context)).status,
    ).toBe("completed");
  });
  it("bounds lock contention and leaves the interrupted item pending", async () => {
    const f = await fixture(2);
    const run = await f.service.preview(f.input, f.context);
    let release!: () => void;
    let locked!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const blocker = database.db.transaction(async (tx) => {
      await tx
        .select()
        .from(financeTransactions)
        .where(eq(financeTransactions.id, required(f.decisions[0]).transactionId))
        .for("update");
      locked();
      await hold;
    });
    await ready;
    try {
      const bounded = createFinanceReviewBatchService({
        db: database.db,
        now,
        finance: f.finance,
        executionBudgetMs: 1_000,
      });
      const partial = await bounded.execute(run.id, { fingerprint: run.fingerprint }, f.context);
      expect(partial).toMatchObject({ pendingCount: 2, outcomes: [] });
    } finally {
      release();
      await blocker;
    }
    expect(
      (await f.service.execute(run.id, { fingerprint: run.fingerprint }, f.context)).status,
    ).toBe("completed");
  }, 15000);
  it("persists exact preview without ledger effects, resumes bounded work and replays once", async () => {
    const f = await fixture(12);
    const preview = await f.service.preview(f.input, f.context);
    expect(preview).toMatchObject({
      status: "previewed",
      pendingCount: 12,
      decisions: f.decisions,
    });
    expect((await transaction(required(f.decisions[0]).transactionId))?.needsReview).toBe(true);
    expect(await f.service.preview(f.input, f.context)).toEqual(preview);
    await expect(
      f.service.preview({ ...f.input, decisions: f.decisions.slice(0, 1) }, f.context),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      f.service.execute(preview.id, { fingerprint: `sha256:${"0".repeat(64)}` }, f.context),
    ).rejects.toMatchObject({ code: "conflict" });
    const partial = await f.service.execute(
      preview.id,
      { fingerprint: preview.fingerprint },
      f.context,
    );
    expect(partial).toMatchObject({ status: "in_progress", pendingCount: 2 });
    const freshService = createFinanceReviewBatchService({
      db: database.db,
      now,
      finance: f.finance,
    });
    expect((await freshService.list(f.context))[0]?.id).toBe(preview.id);
    const completed = await freshService.execute(
      preview.id,
      { fingerprint: preview.fingerprint },
      f.context,
    );
    expect(completed).toMatchObject({ status: "completed", pendingCount: 0 });
    expect(
      await freshService.execute(preview.id, { fingerprint: preview.fingerprint }, f.context),
    ).toEqual(completed);
    expect(
      await database.db
        .select()
        .from(financeClassificationDecisions)
        .where(eq(financeClassificationDecisions.userId, f.userId)),
    ).toHaveLength(12);
  });
  it("rolls back unexpected writer failure and resumes without duplicate effects", async () => {
    const f = await fixture();
    const preview = await f.service.preview(f.input, f.context);
    const failing = createFinanceReviewBatchService({
      db: database.db,
      now,
      finance: {
        ...f.finance,
        async applyCategorizations(...args) {
          await f.finance.applyCategorizations(...args);
          throw new Error("simulated process loss before receipt");
        },
      },
    });
    await expect(
      failing.execute(preview.id, { fingerprint: preview.fingerprint }, f.context),
    ).rejects.toThrow("simulated process loss");
    expect((await transaction(required(f.decisions[0]).transactionId))?.needsReview).toBe(true);
    expect((await f.service.get(preview.id, f.context)).outcomes).toEqual([]);
    expect(
      await database.db
        .select()
        .from(financeClassificationDecisions)
        .where(eq(financeClassificationDecisions.userId, f.userId)),
    ).toHaveLength(0);
    expect(
      (await f.service.execute(preview.id, { fingerprint: preview.fingerprint }, f.context)).status,
    ).toBe("completed");
  });
  it("fails stale transactions independently and preserves their edits", async () => {
    const f = await fixture(2);
    const preview = await f.service.preview(f.input, f.context);
    await database.db
      .update(financeTransactions)
      .set({ notes: "Concurrent edit", updatedAt: now() })
      .where(eq(financeTransactions.id, required(f.decisions[0]).transactionId));
    const run = await f.service.execute(
      preview.id,
      { fingerprint: preview.fingerprint },
      f.context,
    );
    expect(run.status).toBe("completed_with_exceptions");
    expect(run.outcomes.map((item) => item.status)).toEqual(["failed", "applied"]);
    expect(run.outcomes[0]).toMatchObject({ error: { code: "conflict" }, recovery: "new_preview" });
    expect(await transaction(required(f.decisions[0]).transactionId)).toMatchObject({
      needsReview: true,
      notes: "Concurrent edit",
    });
    expect(
      await f.service.execute(preview.id, { fingerprint: preview.fingerprint }, f.context),
    ).toEqual(run);
  });
  it("revision-checks review rows independently and uses the same transaction for defer", async () => {
    const f = await fixture(2, true);
    const first = required(f.decisions[0]);
    const second = required(f.decisions[1]);
    if (first.kind !== "review" || second.kind !== "review") throw new Error("fixture");
    second.action = "defer";
    const preview = await f.service.preview(f.input, f.context);
    await database.db
      .update(financeReviewCases)
      .set({ rationale: "new evidence", updatedAt: now() })
      .where(eq(financeReviewCases.id, first.reviewId));
    const run = await f.service.execute(
      preview.id,
      { fingerprint: preview.fingerprint },
      f.context,
    );
    expect(run.outcomes.map((item) => item.status)).toEqual(["failed", "deferred"]);
    expect(run.status).toBe("completed_with_exceptions");
    expect(
      await database.db.query.financeReviewCases.findFirst({
        where: eq(financeReviewCases.id, second.reviewId),
      }),
    ).toMatchObject({ status: "deferred" });
  });
  it("atomically rolls back review resolution and defer receipts on writer loss", async () => {
    for (const action of ["recategorize", "defer"] as const) {
      const f = await fixture(1, true);
      const decision = required(f.decisions[0]);
      if (decision.kind !== "review") throw new Error("fixture");
      decision.action = action;
      const preview = await f.service.preview(f.input, f.context);
      const failing = createFinanceReviewBatchService({
        db: database.db,
        now,
        finance: {
          ...f.finance,
          async resolveReview(...args) {
            await f.finance.resolveReview(...args);
            throw new Error("lost before outcome");
          },
        },
      });
      await expect(
        failing.execute(preview.id, { fingerprint: preview.fingerprint }, f.context),
      ).rejects.toThrow("lost before outcome");
      expect(
        await database.db.query.financeReviewCases.findFirst({
          where: eq(financeReviewCases.id, decision.reviewId),
        }),
      ).toMatchObject({ status: "open" });
      expect((await f.service.get(preview.id, f.context)).outcomes).toEqual([]);
      expect(
        await database.db.select().from(auditEvents).where(eq(auditEvents.userId, f.userId)),
      ).toHaveLength(0);
    }
  });
  it("serializes concurrent duplicate execution and different runs for one transaction", async () => {
    const f = await fixture();
    const run = await f.service.preview(f.input, f.context);
    const other = await f.service.preview({ ...f.input, idempotencyKey: randomUUID() }, f.context);
    const results = await Promise.all([
      f.service.execute(run.id, { fingerprint: run.fingerprint }, f.context),
      f.service.execute(run.id, { fingerprint: run.fingerprint }, f.context),
      f.service.execute(other.id, { fingerprint: other.fingerprint }, f.context),
    ]);
    expect(results[0]?.outcomes).toEqual(results[1]?.outcomes);
    expect([results[0]?.outcomes[0]?.status, results[2]?.outcomes[0]?.status].sort()).toEqual([
      "applied",
      "failed",
    ]);
    expect(
      await database.db
        .select()
        .from(financeClassificationDecisions)
        .where(eq(financeClassificationDecisions.userId, f.userId)),
    ).toHaveLength(1);
  });
  it("persists exact owner approval and resumes bounded work after the request is gone", async () => {
    const f = await fixture(12);
    const run = await f.service.preview(f.input, f.context);
    const approval = await f.service.approveForContinuation(
      run.id,
      { fingerprint: run.fingerprint },
      f.context,
    );
    expect(approval).toMatchObject({ batchId: run.id, state: "pending" });
    expect(
      await f.service.approveForContinuation(run.id, { fingerprint: run.fingerprint }, f.context),
    ).toEqual(approval);
    expect((await f.service.get(run.id, f.context)).pendingCount).toBe(12);
    await f.service.processApproved();
    expect((await f.service.get(run.id, f.context)).pendingCount).toBe(2);
    // A freshly composed service continues the persisted approval, not an in-memory promise.
    const resumed = createFinanceReviewBatchService({ db: database.db, now, finance: f.finance });
    await resumed.processApproved();
    expect((await resumed.get(run.id, f.context)).pendingCount).toBe(0);
    expect(await resumed.getContinuation(run.id, f.context)).toMatchObject({ state: "completed" });
    await resumed.processApproved();
    expect((await resumed.get(run.id, f.context)).outcomes).toHaveLength(12);
    expect(
      await database.db
        .select()
        .from(financeConversationMessages)
        .where(eq(financeConversationMessages.userId, f.userId)),
    ).toEqual([
      expect.objectContaining({ text: "Batch finished: 12 changes applied.", authorKind: "agent" }),
    ]);
    expect(
      await database.db
        .select()
        .from(nativePushEvents)
        .where(eq(nativePushEvents.userId, f.userId)),
    ).toHaveLength(1);
  });
  it("stops remaining owner-approved effects when the originating preparation grant is revoked", async () => {
    const f = await fixture(12);
    const origin = await agent(f.userId, false);
    const run = await f.service.preview(f.input, origin);
    await f.service.approveForContinuation(run.id, { fingerprint: run.fingerprint }, f.context);
    await f.service.processApproved();
    expect((await f.service.get(run.id, f.context)).pendingCount).toBe(2);
    await database.db
      .update(accessTokens)
      .set({ revokedAt: now() })
      .where(eq(accessTokens.id, origin.principal.actorId));
    await f.service.processApproved();
    expect((await f.service.get(run.id, f.context)).pendingCount).toBe(2);
    expect(
      (await f.service.get(run.id, f.context)).outcomes.filter((row) => row.status === "applied"),
    ).toHaveLength(10);
  });
  it.each([
    1, 2,
  ])("reconciles %i committed effects after process loss across approval expiry", async (appliedCount) => {
    const f = await fixture(2);
    const run = await f.service.preview(f.input, f.context);
    const approval = await f.service.approveForContinuation(
      run.id,
      { fingerprint: run.fingerprint },
      f.context,
    );
    // Effects survived; the worker did not save its final approval/Chat transition.
    await f.service.execute(
      run.id,
      { fingerprint: run.fingerprint, limit: appliedCount },
      f.context,
    );
    await database.db
      .update(financeReviewBatchApprovals)
      .set({ approvedAt: new Date(now().getTime() - 1000), expiresAt: now() })
      .where(eq(financeReviewBatchApprovals.id, approval.id));
    await f.service.processApproved();
    await f.service.processApproved();
    expect(await f.service.getContinuation(run.id, f.context)).toMatchObject({
      state: appliedCount === 2 ? "completed" : "expired",
    });
    const audits = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityId, run.id));
    expect(
      audits.find((row) => row.action.startsWith("finance_review_batch.continuation_"))?.after,
    ).toMatchObject({ applied: appliedCount, remaining: 2 - appliedCount });
    expect(
      await database.db
        .select()
        .from(nativePushEvents)
        .where(eq(nativePushEvents.userId, f.userId)),
    ).toHaveLength(1);
  });
  it("expires approval without effects and reports the saved recovery once", async () => {
    const f = await fixture(1);
    const run = await f.service.preview(f.input, f.context);
    const approval = await f.service.approveForContinuation(
      run.id,
      { fingerprint: run.fingerprint },
      f.context,
    );
    await database.db
      .update(financeReviewBatchApprovals)
      .set({ approvedAt: new Date(now().getTime() - 1000), expiresAt: now() })
      .where(eq(financeReviewBatchApprovals.id, approval.id));
    await f.service.processApproved();
    await f.service.processApproved();
    expect((await f.service.get(run.id, f.context)).pendingCount).toBe(1);
    expect(await f.service.getContinuation(run.id, f.context)).toMatchObject({
      state: "expired",
      recovery: "new_preview",
    });
    expect(
      await database.db
        .select()
        .from(nativePushEvents)
        .where(eq(nativePushEvents.userId, f.userId)),
    ).toHaveLength(1);
  });
  it("bounds unexpected continuation retries and keeps unsaved effects pending", async () => {
    const f = await fixture(1);
    const run = await f.service.preview(f.input, f.context);
    const approval = await f.service.approveForContinuation(
      run.id,
      { fingerprint: run.fingerprint },
      f.context,
    );
    const failure = vi
      .spyOn(f.finance, "applyCategorizations")
      .mockRejectedValue(new Error("Synthetic execution failure"));
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        await database.db
          .update(financeReviewBatchApprovals)
          .set({ nextAttemptAt: now() })
          .where(eq(financeReviewBatchApprovals.id, approval.id));
        await f.service.processApproved();
      }
      expect(await f.service.getContinuation(run.id, f.context)).toMatchObject({
        state: "blocked",
        attempts: 3,
        failureCode: "execution_failed",
      });
      expect((await f.service.get(run.id, f.context)).pendingCount).toBe(1);
      expect(
        await database.db
          .select()
          .from(nativePushEvents)
          .where(eq(nativePushEvents.userId, f.userId)),
      ).toHaveLength(1);
    } finally {
      failure.mockRestore();
    }
  });
  it("recovers an expired worker lease but rejects changed source evidence with an honest result", async () => {
    const f = await fixture(1);
    const run = await f.service.preview(f.input, f.context);
    const approval = await f.service.approveForContinuation(
      run.id,
      { fingerprint: run.fingerprint },
      f.context,
    );
    await database.db
      .update(financeReviewBatchApprovals)
      .set({ state: "running", claimId: randomUUID(), leaseUntil: new Date(now().getTime() - 1) })
      .where(eq(financeReviewBatchApprovals.id, approval.id));
    await database.db
      .update(financeTransactions)
      .set({ amount: 9900, updatedAt: new Date(now().getTime() + 1000) })
      .where(eq(financeTransactions.id, required(f.decisions[0]).transactionId));
    await f.service.processApproved();
    expect(await f.service.getContinuation(run.id, f.context)).toMatchObject({
      state: "completed_with_exceptions",
    });
    expect((await f.service.get(run.id, f.context)).outcomes[0]?.status).toBe("failed");
    expect(
      await database.db
        .select()
        .from(financeConversationMessages)
        .where(eq(financeConversationMessages.userId, f.userId)),
    ).toEqual([
      expect.objectContaining({ text: "Batch finished: 0 changes applied; 1 need another look." }),
    ]);
    await f.service.cancelContinuation(run.id, f.context);
    expect(await f.service.getContinuation(run.id, f.context)).toMatchObject({
      state: "cancelled",
    });
  });
  it("keeps approvals private and does not pick up an unexpired worker lease", async () => {
    const f = await fixture(1),
      other = await fixture(1);
    const run = await f.service.preview(f.input, f.context);
    expect(await f.service.getContinuation(run.id, f.context)).toBeNull();
    await expect(f.service.cancelContinuation(run.id, f.context)).rejects.toMatchObject({
      code: "not_found",
    });
    const approval = await f.service.approveForContinuation(
      run.id,
      { fingerprint: run.fingerprint },
      f.context,
    );
    await expect(other.service.getContinuation(run.id, other.context)).rejects.toMatchObject({
      code: "not_found",
    });
    await database.db
      .update(financeReviewBatchApprovals)
      .set({
        state: "running",
        claimId: randomUUID(),
        leaseUntil: new Date(now().getTime() + 120000),
      })
      .where(eq(financeReviewBatchApprovals.id, approval.id));
    expect(await f.service.processApproved()).toEqual({ inspected: 0 });
    expect((await f.service.get(run.id, f.context)).pendingCount).toBe(1);
    await f.service.cancelContinuation(run.id, f.context);
  });
  it("never accepts agent approval and cancels queued work without applying it", async () => {
    const f = await fixture(1);
    const agentContext = await agent(f.userId, false);
    const run = await f.service.preview(f.input, agentContext);
    await expect(
      f.service.approveForContinuation(run.id, { fingerprint: run.fingerprint }, agentContext),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      f.service.approveForContinuation(
        run.id,
        { fingerprint: `sha256:${"0".repeat(64)}` },
        f.context,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await f.service.approveForContinuation(run.id, { fingerprint: run.fingerprint }, f.context);
    await f.service.cancelContinuation(run.id, f.context);
    await f.service.processApproved();
    expect((await f.service.get(run.id, f.context)).pendingCount).toBe(1);
    expect(await f.service.getContinuation(run.id, f.context)).toMatchObject({
      state: "cancelled",
    });
  });
  it("allows the owner to discover and execute an agent preview with human audit attribution", async () => {
    const f = await fixture(1, true);
    const agentContext = await agent(f.userId, false);
    const run = await f.service.preview(f.input, agentContext);
    expect((await f.service.list(f.context))[0]?.id).toBe(run.id);
    expect((await f.service.get(run.id, f.context)).id).toBe(run.id);
    expect(
      (await f.service.execute(run.id, { fingerprint: run.fingerprint }, f.context)).status,
    ).toBe("completed");
    const audits = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.userId, f.userId));
    expect(audits.length).toBeGreaterThan(0);
    expect(audits.every((event) => event.actorType === "user" && event.actorId === f.userId)).toBe(
      true,
    );
    const stored = await database.db.query.financeReviewBatchRuns.findFirst({
      where: eq(financeReviewBatchRuns.id, run.id),
    });
    expect(stored?.actorId).toBe(agentContext.principal.actorId);
  });
  it("denies wrong-owner access and agent/connection substitution", async () => {
    const f = await fixture();
    const agentContext = await agent(f.userId);
    const run = await f.service.preview(f.input, agentContext);
    const other = await fixture();
    const otherAgent = await agent(f.userId);
    for (const context of [other.context, otherAgent]) {
      expect(await f.service.list(context)).toEqual([]);
      await expect(f.service.get(run.id, context)).rejects.toMatchObject({ code: "not_found" });
      await expect(
        f.service.execute(run.id, { fingerprint: run.fingerprint }, context),
      ).rejects.toMatchObject({ code: "not_found" });
    }
    await expect(
      f.service.get(run.id, {
        ...agentContext,
        principal: { ...agentContext.principal, authorizationConnectionId: randomUUID() },
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
  it("rechecks execution permission, owner policy, revocation and expiry after preview", async () => {
    const f = await fixture();
    const agentContext = await agent(f.userId, false);
    const run = await f.service.preview(f.input, agentContext);
    await expect(
      f.service.execute(run.id, { fingerprint: run.fingerprint }, agentContext),
    ).rejects.toMatchObject({ code: "forbidden" });
    const scopes = ["finances:read", "finances:write", "finances:execute"] as const;
    agentContext.principal.scopes = new Set(scopes);
    await database.db
      .update(accessTokens)
      .set({ scopes: [...scopes] })
      .where(eq(accessTokens.id, agentContext.principal.actorId));
    await database.db
      .update(executionPolicySettings)
      .set({ reviewBypassEnabled: false })
      .where(eq(executionPolicySettings.userId, f.userId));
    await expect(
      f.service.execute(run.id, { fingerprint: run.fingerprint }, agentContext),
    ).rejects.toMatchObject({ code: "forbidden" });
    await database.db
      .update(executionPolicySettings)
      .set({ reviewBypassEnabled: true })
      .where(eq(executionPolicySettings.userId, f.userId));
    await database.db
      .update(accessTokens)
      .set({ expiresAt: stamp })
      .where(eq(accessTokens.id, agentContext.principal.actorId));
    await expect(f.service.get(run.id, agentContext)).rejects.toMatchObject({ code: "forbidden" });
    await database.db
      .update(accessTokens)
      .set({ expiresAt: null, revokedAt: now() })
      .where(eq(accessTokens.id, agentContext.principal.actorId));
    await expect(
      f.service.execute(run.id, { fingerprint: run.fingerprint }, agentContext),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect((await f.service.get(run.id, f.context)).pendingCount).toBe(1);
  });
  it("retains agent proposal policy even with execution scope and supplied confidence", async () => {
    const f = await fixture();
    const context = await agent(f.userId);
    const run = await f.service.preview(f.input, context);
    const executed = await f.service.execute(run.id, { fingerprint: run.fingerprint }, context);
    expect(executed.status).toBe("completed_with_exceptions");
    expect(executed.outcomes[0]?.status).not.toBe("applied");
    expect((await transaction(required(f.decisions[0]).transactionId))?.needsReview).toBe(true);
  });
  it("rejects blind dismissal, learning, missing evidence, duplicates and oversized inputs", async () => {
    const f = await fixture();
    const decision = required(f.decisions[0]);
    for (const decisions of [
      [{ ...decision, evidence: " " }],
      [{ ...decision, learnMerchant: "always" }],
      [{ ...decision, action: "dismiss" }],
      [decision, decision],
      Array.from({ length: 101 }, () => decision),
      [],
    ])
      expect(
        previewFinanceReviewBatchInputSchema.safeParse({ ...f.input, decisions }).success,
      ).toBe(false);
    const run = await f.service.preview(f.input, f.context);
    await expect(
      f.service.execute(run.id, { fingerprint: run.fingerprint, limit: 11 }, f.context),
    ).rejects.toThrow();
    await expect(f.service.list(f.context, { limit: 51 })).rejects.toThrow();
  });
  it("does not route an ambiguous transfer through ordinary categorization", async () => {
    const f = await fixture();
    await database.db.insert(financeReviewCases).values({
      userId: f.userId,
      transactionId: required(f.decisions[0]).transactionId,
      reason: "possible_transfer",
      updatedAt: stamp,
    });
    await expect(f.service.preview(f.input, f.context)).rejects.toMatchObject({
      code: "invalid_request",
    });
  });
  it("replays concurrent previews once and rejects foreign-owner manifest targets", async () => {
    const f = await fixture();
    const [first, second] = await Promise.all([
      f.service.preview(f.input, f.context),
      f.service.preview(f.input, f.context),
    ]);
    expect(first.id).toBe(second.id);
    expect(await f.service.list(f.context)).toHaveLength(1);
    const other = await fixture();
    await expect(
      f.service.preview(
        { ...f.input, idempotencyKey: randomUUID(), decisions: other.decisions },
        f.context,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      f.service.preview(
        {
          ...f.input,
          idempotencyKey: randomUUID(),
          decisions: [
            {
              ...required(f.decisions[0]),
              categoryId: required(
                "categoryId" in required(other.decisions[0])
                  ? (
                      other.decisions[0] as Extract<
                        FinanceReviewBatchDecision,
                        { kind: "categorization" }
                      >
                    ).categoryId
                  : undefined,
              ),
            },
          ],
        },
        f.context,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(await f.service.list(f.context)).toHaveLength(1);
  });
  it("checks persisted scopes even when the caller retains a stale authenticated principal", async () => {
    const f = await fixture();
    const context = await agent(f.userId);
    const run = await f.service.preview(f.input, context);
    await database.db
      .update(accessTokens)
      .set({ scopes: ["finances:read", "finances:write"] })
      .where(eq(accessTokens.id, context.principal.actorId));
    await expect(
      f.service.execute(run.id, { fingerprint: run.fingerprint }, context),
    ).rejects.toMatchObject({ code: "forbidden" });
    await database.db
      .update(accessTokens)
      .set({ scopes: ["finances:read"] })
      .where(eq(accessTokens.id, context.principal.actorId));
    await expect(f.service.preview(f.input, context)).rejects.toMatchObject({ code: "forbidden" });
    expect((await f.service.get(run.id, context)).pendingCount).toBe(1);
  });
  it("resolves only the explicit owned case and preserves duplicate/reimbursement cases and flags", async () => {
    const f = await fixture(1, true);
    const decision = required(f.decisions[0]);
    if (decision.kind !== "review") throw new Error("fixture");
    const foreign = await fixture();
    const siblings = [
      { id: randomUUID(), userId: f.userId, reason: "possible_duplicate" as const },
      { id: randomUUID(), userId: f.userId, reason: "possible_reimbursement" as const },
      { id: randomUUID(), userId: foreign.userId, reason: "low_confidence" as const },
    ];
    await database.db.insert(financeReviewCases).values(
      siblings.map((row) => ({
        ...row,
        transactionId: decision.transactionId,
        updatedAt: stamp,
      })),
    );
    const run = await f.service.preview(f.input, f.context);
    const result = await f.service.execute(run.id, { fingerprint: run.fingerprint }, f.context);
    expect(result.outcomes[0]?.status).toBe("applied");
    expect(await transaction(decision.transactionId)).toMatchObject({ needsReview: true });
    expect(
      await database.db.query.financeReviewCases.findFirst({
        where: eq(financeReviewCases.id, decision.reviewId),
      }),
    ).toMatchObject({ status: "resolved" });
    for (const row of siblings)
      expect(
        await database.db.query.financeReviewCases.findFirst({
          where: eq(financeReviewCases.id, row.id),
        }),
      ).toMatchObject({ status: "open", contextualRevision: 1n, updatedAt: stamp });
  });
  it("ordinary categorization leaves all existing cases and their outstanding flags intact", async () => {
    const f = await fixture();
    const decision = required(f.decisions[0]);
    const reviewId = randomUUID();
    await database.db.insert(financeReviewCases).values({
      id: reviewId,
      userId: f.userId,
      transactionId: decision.transactionId,
      reason: "possible_duplicate",
      updatedAt: stamp,
    });
    const run = await f.service.preview(f.input, f.context);
    await f.service.execute(run.id, { fingerprint: run.fingerprint }, f.context);
    expect(await transaction(decision.transactionId)).toMatchObject({ needsReview: true });
    expect(
      await database.db.query.financeReviewCases.findFirst({
        where: eq(financeReviewCases.id, reviewId),
      }),
    ).toMatchObject({ status: "open", contextualRevision: 1n });
  });
  it("rejects timestamp-only manifests rather than guessing missing generations", async () => {
    const f = await fixture(1, true);
    const decision = required(f.decisions[0]);
    for (const field of [
      "expectedTransactionRevision",
      "expectedReviewRevision",
      "expectedActionRevision",
    ]) {
      const incomplete = { ...decision } as Record<string, unknown>;
      delete incomplete[field];
      await expect(
        f.service.preview({ ...f.input, decisions: [incomplete] }, f.context),
      ).rejects.toThrow();
    }
  });
  it("rejects transaction and review changes with identical timestamps", async () => {
    for (const change of ["transaction", "review"] as const) {
      const f = await fixture(1, true);
      const decision = required(f.decisions[0]);
      if (decision.kind !== "review") throw new Error("fixture");
      const run = await f.service.preview(f.input, f.context);
      if (change === "transaction")
        await database.db
          .update(financeTransactions)
          .set({ amount: 2000 })
          .where(eq(financeTransactions.id, decision.transactionId));
      else
        await database.db
          .update(financeReviewCases)
          .set({ rationale: "New review evidence" })
          .where(eq(financeReviewCases.id, decision.reviewId));
      const result = await f.service.execute(run.id, { fingerprint: run.fingerprint }, f.context);
      expect(result.outcomes[0]).toMatchObject({ status: "failed", error: { code: "conflict" } });
      expect((await transaction(decision.transactionId))?.updatedAt).toEqual(stamp);
      expect((await transaction(decision.transactionId))?.needsReview).toBe(true);
    }
  });
  it("rejects newly issued review actions whose timestamp is unchanged", async () => {
    const f = await fixture(1, true);
    const decision = required(f.decisions[0]);
    if (decision.kind !== "review") throw new Error("fixture");
    const run = await f.service.preview(f.input, f.context);
    const transition = decideFinanceReviewActionTransition({
      current: { state: "absent" },
      intent: "observe",
      desired: {
        action: {
          version: 1,
          kind: "question",
          answerMode: "free_text",
          purpose: "maintenance_clarification",
        },
        basis: {
          subject: { kind: "transaction", id: decision.transactionId },
          source: { kind: "finance_review_case", id: decision.reviewId },
          reason: "missing_provenance",
          consequence: { kind: "resume_finance_maintenance", target: "same_review_case" },
        },
        work: { domain: "finances", kind: "question", id: decision.reviewId, revision: "2" },
      },
    });
    const issued = issueFinanceReviewAction({
      decision: transition,
      authorityOperationId: randomUUID(),
      requestId: randomUUID(),
      retirementOperationId: null,
      actionRevision: "1",
    });
    if (issued.decision !== "issue") throw new Error("fixture issuance");
    await database.db.transaction(async (tx) => {
      await tx.insert(financeReviewActionRequests).values({
        id: issued.request.requestId,
        userId: f.userId,
        reviewCaseId: decision.reviewId,
        authorityOperationId: issued.request.authorityOperationId,
        actionRevision: 1n,
        request: issued.request,
        prompt: "What was this purchase?",
      });
      await tx
        .update(financeReviewCases)
        .set({ humanAction: { state: "open", request: issued.request } })
        .where(eq(financeReviewCases.id, decision.reviewId));
    });
    const changed = await database.db.query.financeReviewCases.findFirst({
      where: eq(financeReviewCases.id, decision.reviewId),
    });
    expect(changed).toMatchObject({ contextualRevision: 2n, actionRevision: 1n, updatedAt: stamp });
    expect(
      (await f.service.execute(run.id, { fingerprint: run.fingerprint }, f.context)).outcomes[0],
    ).toMatchObject({ status: "failed", error: { code: "conflict" } });
    // Even a current work revision cannot waive the separate accepted action generation.
    await expect(
      f.service.preview(
        { idempotencyKey: randomUUID(), decisions: [{ ...decision, expectedReviewRevision: "2" }] },
        f.context,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});
