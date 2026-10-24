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
