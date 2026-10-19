import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  accessTokens,
  automationHostSchedules,
  createDatabaseClient,
  type DatabaseClient,
  executionPolicySettings,
  financeAccounts,
  financeConversationMessages,
  financeLedgerChallenges,
  financeMaintenanceCandidateItems,
  financeMaintenanceCandidates,
  financeMutationRecords,
  financeReviewAnswers,
  financeReviewCases,
  financeTransactions,
  migrateDatabase,
  users,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import { automationHostScheduleSchema, financeLedgerChallengeChecks } from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq } from "drizzle-orm";
import { createFinanceActionService } from "../finance-action-service.js";
import { createFinanceChallengeService } from "../finance-challenge-service.js";
import { createFinanceService } from "../finance-service.js";
import type { Principal } from "../types.js";
import { createWorkspaceMaintenanceService } from "../workspace-maintenance-service.js";
import { loadFinanceAuthorization } from "./context.js";
import { createFinanceContextualQuestionService } from "./contextual-question-service.js";
import { createFinanceConversationService } from "./conversation-persistence.js";
import {
  captureFinanceConversationBatch,
  postgresConversationBatchStore,
} from "./conversation-service.js";
import { createInboxService } from "./inbox-service.js";

/** Authored for Lead's exclusive PG slot; real bound producer/submit/settle paths, no mocked authority. */
describe.sequential("Finance bound causal settlement", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120_000);
  afterAll(async () => {
    try {
      await database?.close();
    } finally {
      await container?.stop();
    }
  });
  async function fixture() {
    const userId = randomUUID();
    await database.db.insert(users).values({
      id: userId,
      displayName: "Conversation",
      email: `${userId}@example.com`,
      passwordHash: "unused",
    });
    const [account] = await database.db
      .insert(financeAccounts)
      .values({ userId, provider: "manual", institution: "Manual", name: "Cash" })
      .returning();
    if (!account) throw new Error("account");
    const [transaction] = await database.db
      .insert(financeTransactions)
      .values({
        userId,
        accountId: account.id,
        amount: 1200,
        merchant: "Lunch",
        direction: "expense",
        transactionDate: "2026-10-18",
      })
      .returning();
    if (!transaction) throw new Error("transaction");
    const principal: Principal = {
      userId,
      actorId: userId,
      actorType: "user",
      scopes: new Set(["finances:read", "finances:write"]),
    };
    const context = { principal, requestId: randomUUID() };
    const questions = createFinanceContextualQuestionService({ db: database.db });
    const question = await questions.createQuestion(
      transaction.id,
      { operationId: randomUUID() },
      context,
    );
    if (question.state !== "available") throw new Error("question");
    const answer = {
      operationId: randomUUID(),
      work: question.question.work,
      text: "Lunch with a friend",
      source: { kind: "app", messageId: null },
    };
    return {
      userId,
      account,
      transaction,
      principal,
      context,
      questions,
      question: question.question,
      answer,
    };
  }
  async function canonicalRun(userId: string) {
    const [run] = await database.db
      .insert(workspaceMaintenanceRuns)
      .values({
        userId,
        domain: "finances",
        scope: { type: "all_outstanding" },
        rulebookVersion: "conversation-fixture",
      })
      .returning();
    if (!run) throw new Error("run");
    return run;
  }
  async function hostFixture(verifyImmediately = true) {
    const f = await fixture();
    const connectionId = randomUUID();
    const scheduleId = randomUUID();
    const scopes = [
      "finances:read",
      "finances:write",
      "finances:execute",
      "finances:maintain",
    ] as const;
    const [token] = await database.db
      .insert(accessTokens)
      .values({
        userId: f.userId,
        name: "Conversation host",
        authorizationConnectionId: connectionId,
        tokenHash: randomUUID(),
        scopes: [...scopes],
      })
      .returning();
    if (!token) throw new Error("token");
    await database.db
      .insert(executionPolicySettings)
      .values({ userId: f.userId, reviewBypassEnabled: true });
    const stamp = new Date().toISOString();
    await database.db.insert(automationHostSchedules).values({
      id: scheduleId,
      userId: f.userId,
      authorizationConnectionId: connectionId,
      schedule: automationHostScheduleSchema.parse({
        id: scheduleId,
        tenantAuthorizationConnectionId: connectionId,
        hostSurface: "codex_desktop",
        hostAutomationId: "conversation-fixture",
        label: "Conversation",
        effectiveScopes: [...scopes],
        trigger: {
          type: "recurring",
          recurrence: { type: "interval", everyMinutes: 2, timeZone: "America/New_York" },
        },
        state: "active",
        lastObservedAt: stamp,
        nextExpectedAt: stamp,
        version: 1,
        createdAt: stamp,
        updatedAt: stamp,
      }),
    });
    const agent: Principal = {
      userId: f.userId,
      actorId: token.id,
      actorType: "agent",
      authorizationConnectionId: connectionId,
      scopes: new Set(scopes),
    };
    const conversation = createFinanceConversationService({ db: database.db });
    const verify = async () => {
      const challenge = await conversation.issueChallenge(f.principal, scheduleId);
      const fetched = await conversation.advanceChallenge(agent, challenge.challengeId, {
        kind: "fetch",
      });
      if (!fetched.nonce) throw new Error("nonce");
      await conversation.advanceChallenge(agent, challenge.challengeId, {
        kind: "acknowledge",
        challengeId: challenge.challengeId,
        nonce: fetched.nonce,
      });
      await conversation.advanceChallenge(agent, challenge.challengeId, {
        kind: "respond",
        challengeId: challenge.challengeId,
        response: "Finance message protocol ready",
      });
    };
    if (verifyImmediately) await verify();
    return { ...f, conversation, agent, scheduleId, connectionId, token, verify };
  }

  async function boundCandidate() {
    const f = await hostFixture();
    const [transaction] = await database.db
      .insert(financeTransactions)
      .values({
        userId: f.userId,
        accountId: f.account.id,
        amount: 3400,
        merchant: "Causal purchase",
        direction: "expense",
        transactionDate: "2026-10-18",
      })
      .returning();
    if (!transaction) throw new Error("transaction");
    const created = await f.questions.createQuestion(
      transaction.id,
      { operationId: randomUUID() },
      { principal: f.agent, requestId: randomUUID() },
    );
    if (created.state !== "available") throw new Error("question");
    const accepted = await f.questions.answerWork(
      {
        operationId: randomUUID(),
        work: created.question.work,
        text: "Record my actual explanation",
        source: { kind: "app", messageId: null },
      },
      f.context,
    );
    expect(accepted.state).toBe("accepted");
    const messages = await database.db
      .select()
      .from(financeConversationMessages)
      .where(eq(financeConversationMessages.userId, f.userId));
    const question = messages.find(
      (m) =>
        m.authorKind === "agent" &&
        m.recordRefs.some(
          (r) => r.kind === "contextual_question" && r.id === created.question.work.id,
        ),
    );
    const answer = messages.find(
      (m) => m.authorKind === "user" && m.sourceOperationId === accepted.operationId,
    );
    if (!question || !answer) throw new Error("canonical messages");
    const note = await f.conversation.send(f.principal, {
      text: "Use this extra transaction context without claiming an answer or approval",
      idempotencyKey: randomUUID(),
      caseId: answer.caseId,
      recordRefs: [{ kind: "transaction", id: transaction.id }],
    });
    const forgedAnswer = await f.conversation.send(f.principal, {
      text: "Ordinary note with claimed canonical question refs",
      idempotencyKey: randomUUID(),
      caseId: answer.caseId,
      recordRefs: answer.recordRefs,
    });
    const unrelated = await f.conversation.send(f.principal, {
      text: "An ordinary note does not answer a canonical question",
      idempotencyKey: randomUUID(),
      caseId: null,
      recordRefs: [],
    });
    const run = await canonicalRun(f.userId);
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({ automationScheduleId: f.scheduleId, authorizationConnectionId: f.connectionId })
      .where(eq(workspaceMaintenanceRuns.id, run.id));
    await database.db.transaction((tx) =>
      captureFinanceConversationBatch({
        tx,
        store: postgresConversationBatchStore,
        userId: f.userId,
        runId: run.id,
        automationScheduleId: f.scheduleId,
        authorizationConnectionId: f.connectionId,
        now: new Date(),
      }),
    );
    const finances = createFinanceService({ db: database.db, now: () => new Date() });
    const actions = createFinanceActionService({
      db: database.db,
      finances,
      now: () => new Date(),
    });
    const draft = await actions.prepareMaintenanceCandidateDraft(
      "transaction",
      { id: transaction.id, notes: "Causally explained purchase" },
      f.userId,
    );
    expect(draft.disposition).toBe("prepared");
    const [candidate] = await database.db
      .insert(financeMaintenanceCandidates)
      .values({
        userId: f.userId,
        runId: run.id,
        revision: `sha256:${"0".repeat(64)}`,
        state: "preparing",
      })
      .returning();
    if (!candidate) throw new Error("candidate");
    const [item] = await database.db
      .insert(financeMaintenanceCandidateItems)
      .values({ ...draft, candidateId: candidate.id, ordinal: 0 })
      .returning();
    if (!item) throw new Error("item");
    const snapshot = await finances.maintenanceCandidateSnapshot(f.userId, run.scope, [item], null);
    await database.db
      .update(financeMaintenanceCandidates)
      .set({
        revision: snapshot.revision,
        projection: snapshot.projection,
        state: "ready_for_challenge",
      })
      .where(eq(financeMaintenanceCandidates.id, candidate.id));
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({
        status: "awaiting_agent_challenge",
        checkpoint: { candidateId: candidate.id, phase: "challenge", revision: snapshot.revision },
      })
      .where(eq(workspaceMaintenanceRuns.id, run.id));
    const challenges = createFinanceChallengeService({
      actions,
      db: database.db,
      finances,
      now: () => new Date(),
    });
    const challenge = await challenges.prepare(f.userId, run.id, candidate.id);
    const input = {
      candidateRevision: snapshot.revision,
      challengeId: challenge.id,
      checked: [...financeLedgerChallengeChecks],
      findings: [],
      reviewedItemIds: [item.id],
      rubricVersion: "finance-ledger-challenge-v1" as const,
    };
    const context = { principal: f.agent, requestId: randomUUID() };
    const submit = (ids: string[]) =>
      challenges.submit(
        {
          ...input,
          conversationEvidence: {
            sourceMessageIds: ids,
            explanation: "Use the actual delivered answer and canonical question.",
          },
        },
        context,
      );
    const receipts = () =>
      database.db
        .select()
        .from(financeMutationRecords)
        .where(
          and(
            eq(financeMutationRecords.userId, f.userId),
            eq(financeMutationRecords.operation, "commit_finance_candidate_effect_v1"),
          ),
        );
    return {
      ...f,
      transaction,
      question,
      answer,
      run,
      candidate,
      item,
      actions,
      challenges,
      context,
      submit,
      receipts,
      unrelated,
      forgedAnswer,
      note,
    };
  }
  it("rejects undelivered current answers then commits actual delivered answer plus prior question once, preserving replay", async () => {
    const f = await boundCandidate();
    await expect(f.submit([f.question.id, f.answer.id])).rejects.toThrow("delivered");
    expect(await f.receipts()).toHaveLength(0);
    const page = await f.conversation.pageBatch(f.agent, f.run.id);
    expect(page.messages.map((m) => m.id)).toContain(f.answer.id);
    expect(page.messages.map((m) => m.id)).not.toContain(f.question.id);
    const submitted = await f.submit([f.question.id, f.answer.id]);
    expect(await f.submit([f.question.id, f.answer.id])).toEqual(submitted);
    const resolution = await f.challenges.resolve(f.userId, f.run.id);
    if (!resolution.candidateRevision) throw new Error("revision");
    // The canonical maintenance runner claims queued resolution work and releases
    // its exact challenge checkpoint before settlement; resolve() alone is not that handoff.
    const maintenance = createWorkspaceMaintenanceService({
      db: database.db,
      now: () => new Date(),
    });
    const claimed = await maintenance.claim(f.run.id);
    if (!claimed) throw new Error("resolution claim");
    await maintenance.checkpointAndRelease({
      runId: f.run.id,
      claimId: claimed.claimId,
      status: "awaiting_agent_challenge",
      checkpoint: {
        candidateId: f.candidate.id,
        phase: "challenge",
        revision: resolution.candidateRevision,
      },
    });
    const effect = () =>
      f.actions.settleFinanceMaintenanceCandidate(
        f.candidate.id,
        resolution.candidateRevision as string,
        f.context,
      );
    await effect();
    await effect();
    const receipts = await f.receipts();
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.response?.financeEffectReceipt).toMatchObject({
      sourceMessageIds: [f.question.id, f.answer.id],
      authorityBasis: "original_live_grant",
      status: "applied",
    });
    const [changed] = await database.db
      .select()
      .from(financeTransactions)
      .where(eq(financeTransactions.id, f.transaction.id));
    expect(changed?.notes).toBe("Causally explained purchase");
  });
  it("accepts delivered ordinary context without treating it as a canonical answer or approval", async () => {
    const f = await boundCandidate();
    await f.conversation.pageBatch(f.agent, f.run.id);
    await f.submit([f.note.id]);
    expect(await f.receipts()).toHaveLength(0);
    // Submission records context only; financial settlement and exact budget authority remain separate.
    expect(f.note.recordRefs.some((ref) => ref.kind === "contextual_question")).toBe(false);
    const [unchanged] = await database.db
      .select()
      .from(financeTransactions)
      .where(eq(financeTransactions.id, f.transaction.id));
    expect(unchanged?.notes).toBeNull();
  });
  it("rejects foreign, late and unrelated same-owner sources without admitting claims or effects", async () => {
    const f = await boundCandidate();
    const foreign = await hostFixture();
    const foreignMessage = await foreign.conversation.send(foreign.principal, {
      text: "Foreign",
      idempotencyKey: randomUUID(),
      caseId: null,
      recordRefs: [],
    });
    await expect(f.submit([foreignMessage.id, f.answer.id])).rejects.toThrow("owner");
    const late = await f.conversation.send(f.principal, {
      text: "After cutoff",
      idempotencyKey: randomUUID(),
      caseId: null,
      recordRefs: [],
    });
    await expect(f.submit([late.id, f.answer.id])).rejects.toThrow("cutoff");
    await f.conversation.pageBatch(f.agent, f.run.id);
    await expect(f.submit([f.unrelated.id])).rejects.toThrow("canonical Finance case");
    await expect(f.submit([f.question.id, f.forgedAnswer.id])).rejects.toThrow("canonical");
    const unrelated = await database.db
      .select()
      .from(financeConversationMessages)
      .where(
        and(
          eq(financeConversationMessages.userId, foreign.userId),
          eq(financeConversationMessages.authorKind, "user"),
        ),
      );
    await expect(f.submit([f.question.id, foreignMessage.id])).rejects.toThrow();
    expect(unrelated).toHaveLength(1);
    expect(await f.receipts()).toHaveLength(0);
  });
  it("mirrors only a newly projected actual-agent ReviewCase question and its canonical owner answer, retaining exact retry identity", async () => {
    const f = await hostFixture();
    const [transaction] = await database.db
      .insert(financeTransactions)
      .values({
        userId: f.userId,
        accountId: f.account.id,
        amount: 1800,
        merchant: "Review prompt",
        direction: "expense",
        transactionDate: "2026-10-18",
        needsReview: true,
      })
      .returning();
    if (!transaction) throw new Error("transaction");
    const run = await canonicalRun(f.userId);
    const claimId = randomUUID();
    const revision = `sha256:${"e".repeat(64)}`;
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({
        automationScheduleId: f.scheduleId,
        authorizationConnectionId: f.connectionId,
        status: "running",
        leaseClaimId: claimId,
        leaseExpiresAt: new Date(Date.now() + 60000),
      })
      .where(eq(workspaceMaintenanceRuns.id, run.id));
    const [candidate] = await database.db
      .insert(financeMaintenanceCandidates)
      .values({ userId: f.userId, runId: run.id, revision, state: "challenged" })
      .returning();
    if (!candidate) throw new Error("candidate");
    await database.db.insert(financeMaintenanceCandidateItems).values({
      candidateId: candidate.id,
      ordinal: 0,
      actionKind: "question",
      disposition: "question",
      expectedRevision: transaction.updatedAt.toISOString(),
      fingerprint: `sha256:${"f".repeat(64)}`,
      privatePayload: {
        prompt: "Was this an actual shared meal?",
        why: "Need owner evidence",
        reviewReason: "category_ambiguity",
        underlyingAction: "transaction",
        transactionId: transaction.id,
        choices: [],
      },
      sourceRefs: [],
    });
    await database.db.insert(financeLedgerChallenges).values({
      userId: f.userId,
      runId: run.id,
      candidateId: candidate.id,
      candidateRevision: revision,
      rubricVersion: "finance-ledger-challenge-v1",
      cutoff: new Date(),
      state: "resolved",
      submittingAgentId: f.agent.actorId,
    });
    const finances = createFinanceService({ db: database.db, now: () => new Date() });
    const input = {
      userId: f.userId,
      runId: run.id,
      candidateId: candidate.id,
      candidateRevision: revision,
      context: {
        principal: f.agent,
        requestId: randomUUID(),
        maintenanceClaim: { claimId, runId: run.id },
        maintenance: {
          runId: run.id,
          rulebookVersion: run.rulebookVersion,
          policy: "approved_rule" as const,
          idempotencyKey: randomUUID(),
        },
      },
    };
    await finances.projectMaintenanceCandidateQuestionsForUser(input);
    await finances.projectMaintenanceCandidateQuestionsForUser({
      ...input,
      context: { ...input.context, requestId: randomUUID() },
    });
    const [review] = await database.db
      .select()
      .from(financeReviewCases)
      .where(
        and(
          eq(financeReviewCases.userId, f.userId),
          eq(financeReviewCases.transactionId, transaction.id),
        ),
      );
    if (!review) throw new Error("review");
    const messages = () =>
      database.db
        .select()
        .from(financeConversationMessages)
        .where(eq(financeConversationMessages.userId, f.userId));
    const questions = (await messages()).filter((m) => m.authorKind === "agent");
    expect(questions).toHaveLength(1);
    expect(questions[0]?.text).toBe("Was this an actual shared meal?");
    expect(questions[0]?.recordRefs.some((r) => r.kind === "contextual_question")).toBe(false);
    const inbox = createInboxService({ db: database.db, now: () => new Date() });
    const context = await loadFinanceAuthorization({ db: database.db, ...f.context });
    const answer = {
      idempotencyKey: randomUUID(),
      answer: "Shared meal",
      resolution: { type: "clarify" as const, clarification: "This was a shared meal" },
    };
    await inbox.answerFinanceReview(review.id, answer, context);
    await inbox.answerFinanceReview(review.id, answer, context);
    const accepted = (await messages()).filter((m) => m.authorKind === "user");
    expect(accepted).toHaveLength(1);
    expect(accepted[0]?.sourceMessageIds).toEqual([questions[0]?.id]);
    expect(accepted[0]?.text).toBe(answer.resolution.clarification);
    const persisted = await database.db
      .select()
      .from(financeReviewAnswers)
      .where(eq(financeReviewAnswers.reviewCaseId, review.id));
    expect(persisted).toHaveLength(1);
    expect(accepted[0]?.sourceOperationId).toBe(persisted[0]?.operationId);
    const followup = await f.conversation.send(f.principal, {
      text: "Additional context",
      caseId: review.id,
      idempotencyKey: randomUUID(),
      recordRefs: [{ kind: "transaction", id: transaction.id }],
    });
    expect(followup.id).not.toBe(accepted[0]?.id);
    expect((await messages()).filter((m) => m.authorKind === "agent")).toHaveLength(1);
    expect((await messages()).filter((m) => m.authorKind === "user")).toHaveLength(2);
  });
});
