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
  financeReviewActionRequests,
  financeReviewBatchRuns,
  financeReviewCases,
  financeTransactions,
  migrateDatabase,
  users,
} from "@personal-os/database";
import {
  decideFinanceReviewActionTransition,
  type FinanceReviewBatchDecision,
  issueFinanceReviewAction,
  previewFinanceReviewBatchInputSchema,
} from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { createFinanceService } from "../finance-service.js";
import type { Principal } from "../types.js";
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
  it.each([
    "same batch",
    "resumed chunk",
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
      f.agentContext,
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
    await database.db.insert(financeTransactions).values({ ...original, id: thirdId });
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
      reviewId: required(thirdReview).id,
      expectedReviewRevision: "1",
    };
    await expect(
      f.service.preview({ idempotencyKey: randomUUID(), decisions: [third] }, f.agentContext),
    ).rejects.toMatchObject({ code: "invalid_request" });
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
  it("bounds pool acquisition and never starts work acquired after the deadline", async () => {
    const f = await fixture();
    const run = await f.service.preview(f.input, f.context);
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let acquisition: Promise<unknown> | undefined;
    const delayedDb = new Proxy(database.db, {
      get(target, key, receiver) {
        if (key !== "transaction") return Reflect.get(target, key, receiver);
        return (...args: Parameters<typeof database.db.transaction>) => {
          acquisition = hold.then(() => target.transaction(...args));
          return acquisition;
        };
      },
    });
    const bounded = createFinanceReviewBatchService({
      db: delayedDb,
      now,
      finance: f.finance,
      executionBudgetMs: 20,
    });
    await expect(
      bounded.execute(run.id, { fingerprint: run.fingerprint }, f.context),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    release();
    await expect(acquisition).rejects.toMatchObject({ code: "service_unavailable" });
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
  });
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
  it("allows the owner to discover and execute an agent preview with human audit attribution", async () => {
    const f = await fixture(1, true);
    const agentContext = await agent(f.userId, false);
    const run = await f.service.preview(f.input, agentContext);
    expect((await f.service.list(f.context))[0]?.id).toBe(run.id);
    expect((await f.service.get(run.id, f.context)).id).toBe(run.id);
    await database.db
      .update(accessTokens)
      .set({ revokedAt: now() })
      .where(eq(accessTokens.id, agentContext.principal.actorId));
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
            { ...required(f.decisions[0]), categoryId: required(other.decisions[0]).categoryId },
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
