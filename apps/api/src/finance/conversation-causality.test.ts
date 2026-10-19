import { randomUUID } from "node:crypto";
import {
  accessTokens,
  auditEvents,
  automationHostSchedules,
  type Database,
  executionPolicySettings,
  financeContextualQuestions,
  financeConversationBatches,
  financeConversationBatchMessages,
  financeConversationCapabilities,
  financeConversationMessages,
  type financeMaintenanceCandidateItems,
  financeReviewActionRequests,
  financeReviewCases,
  financeTransactions,
  users,
  type workspaceMaintenanceRuns,
} from "@personal-os/database";
import {
  financeCandidateRecordIds,
  loadFinanceEffectPrincipal,
  lockFinanceEffectOwner,
  requireFinanceEffectMessageProof,
  validateFinanceConversationClaim,
} from "./conversation-causality.js";
import { guardFinanceExecutionTransaction } from "./execution-owner-guard.js";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
async function fixture() {
  const userId = randomUUID(),
    actorId = randomUUID(),
    connection = randomUUID(),
    schedule = randomUUID(),
    runId = randomUUID(),
    caseId = randomUUID(),
    transactionId = randomUUID();
  const at = new Date(),
    principal = {
      userId,
      actorId,
      actorType: "agent" as const,
      authorizationConnectionId: connection,
      scopes: new Set(["finances:maintain", "finances:write", "finances:execute"] as const),
    };
  const run = {
    id: runId,
    userId,
    automationScheduleId: schedule as string | null,
    authorizationConnectionId: connection as string | null,
  } as typeof workspaceMaintenanceRuns.$inferSelect;
  const token = {
    id: actorId,
    userId,
    authorizationConnectionId: connection,
    scopes: [...principal.scopes],
    revokedAt: null as Date | null,
    expiresAt: null as Date | null,
  };
  const batch = {
    authorizationConnectionId: connection,
    automationScheduleId: schedule,
    cutoffSequence: 10n,
  };
  const answer = {
    id: randomUUID(),
    sequence: 5n,
    authorKind: "user",
    caseId: caseId as string | null,
    sourceOperationId: null as string | null,
    sourceMessageIds: [] as string[],
    text: "A delivered owner note",
    recordRefs: [
      { kind: "review_case", id: caseId },
      { kind: "transaction", id: transactionId },
    ],
  };
  const item = {
    safeChanges: [{ entityId: transactionId }],
    sourceRefs: [],
  } as unknown as typeof financeMaintenanceCandidateItems.$inferSelect;
  const rows = new Map<unknown, unknown[]>([
    [users, [{ id: userId }]],
    [accessTokens, [token]],
    [
      automationHostSchedules,
      [{ id: schedule, authorizationConnectionId: connection, schedule: { state: "active" } }],
    ],
    [executionPolicySettings, [{ reviewBypassEnabled: true }]],
    [financeConversationCapabilities, [{ generation: 1n, verifiedAt: at }]],
    [financeConversationBatches, [batch]],
    [financeConversationMessages, [answer]],
    [financeConversationBatchMessages, [{ id: answer.id }]],
    [financeReviewCases, [{ id: caseId, transactionId }]],
    [financeTransactions, [{ id: transactionId }]],
  ]);
  const queues = new Map<unknown, unknown[][]>();
  const query = (table: unknown) => {
    const chain = Object.assign(
      Promise.resolve(queues.get(table)?.shift() ?? rows.get(table) ?? []),
      { where: () => chain, for: () => chain, orderBy: () => chain, limit: () => chain },
    );
    return chain;
  };
  const tx = {
    select: () => ({ from: query }),
    execute: async () => ({ rows: [] }),
  } as unknown as Tx;
  await guardFinanceExecutionTransaction(tx, userId, {
    actorIds: [actorId],
    connectionIds: [connection],
  });
  await lockFinanceEffectOwner(tx, userId);
  const claim = {
    sourceMessageIds: [answer.id],
    explanation: "The exact delivered context informs this prepared action.",
  };
  return {
    rows,
    queues,
    tx,
    token,
    run,
    principal,
    batch,
    answer,
    item,
    claim,
    at,
    caseId,
    transactionId,
    validate: () => validateFinanceConversationClaim(tx, run, principal, [item], claim, at),
  };
}
describe("server-validated Finance conversation causality", () => {
  it("uses only actual canonical affected record identifiers", () => {
    const items = [
      {
        safeChanges: [{ entityId: "change" }, { entityId: 7 }],
        sourceRefs: [
          { remoteId: "source", sourceType: "finance_transaction" },
          { remoteId: "foreign", sourceType: "calendar_event" },
          { remoteId: 5, sourceType: "finance_transaction" },
        ],
      },
    ] as unknown as Array<typeof financeMaintenanceCandidateItems.$inferSelect>;
    expect([...financeCandidateRecordIds(items)]).toEqual(["change", "source"]);
  });
  it("retains legacy unbound principal semantics without inventing a host", async () => {
    const f = await fixture();
    f.run.automationScheduleId = null;
    f.run.authorizationConnectionId = null;
    expect(await loadFinanceEffectPrincipal(f.tx, f.run, f.principal, f.at, true)).toBe(
      f.principal,
    );
    await expect(
      requireFinanceEffectMessageProof(f.tx, f.run, f.principal, f.at),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
  it.each([
    "revoked",
    "expired",
    "missing",
    "connection",
  ])("never restores unavailable original grant %s", async (variant) => {
    const f = await fixture();
    if (variant === "revoked") f.token.revokedAt = f.at;
    if (variant === "expired") f.token.expiresAt = f.at;
    if (variant === "missing") f.rows.set(accessTokens, []);
    if (variant === "connection") f.token.authorizationConnectionId = randomUUID();
    await expect(
      loadFinanceEffectPrincipal(f.tx, f.run, f.principal, f.at, true),
    ).rejects.toMatchObject({ code: variant === "expired" ? "conflict" : "forbidden" });
  });
  it("reconstructs current persisted scopes and checks standing policy only when requested", async () => {
    const f = await fixture();
    expect(await loadFinanceEffectPrincipal(f.tx, f.run, f.principal, f.at, true)).toMatchObject({
      actorId: f.token.id,
      scopes: new Set(f.token.scopes),
    });
    f.rows.set(executionPolicySettings, []);
    await expect(
      loadFinanceEffectPrincipal(f.tx, f.run, f.principal, f.at, true),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await loadFinanceEffectPrincipal(f.tx, f.run, f.principal, f.at, false)).toMatchObject({
      actorId: f.token.id,
    });
  });
  it.each([
    "missing",
    "connection",
    "schedule",
  ])("rejects a nonoriginal fixed batch %s", async (variant) => {
    const f = await fixture();
    if (variant === "missing") f.rows.set(financeConversationBatches, []);
    if (variant === "connection") f.batch.authorizationConnectionId = randomUUID();
    if (variant === "schedule") f.batch.automationScheduleId = randomUUID();
    await expect(f.validate()).rejects.toMatchObject({ code: "conflict" });
  });
  it.each([
    "missing",
    "late",
    "undelivered",
    "agent",
  ])("requires actual current delivered owner context: %s", async (variant) => {
    const f = await fixture();
    if (variant === "missing") f.rows.set(financeConversationMessages, []);
    if (variant === "late") f.answer.sequence = 11n;
    if (variant === "undelivered") f.rows.set(financeConversationBatchMessages, []);
    if (variant === "agent") f.answer.authorKind = "agent";
    await expect(f.validate()).rejects.toMatchObject({ code: "conflict" });
  });
  it("accepts an actually delivered case-linked note without pretending it is a canonical accepted answer", async () => {
    const f = await fixture();
    expect(await f.validate()).toMatchObject({ batch: f.batch, messages: [f.answer] });
    expect(f.answer.sourceOperationId).toBeNull();
    f.answer.caseId = null;
    expect(await f.validate()).toMatchObject({ messages: [f.answer] });
  });
  it.each([
    "case",
    "review",
    "transaction",
    "affected-record",
    "record-ref",
  ])("requires exact case/record provenance %s", async (variant) => {
    const f = await fixture();
    if (variant === "case") {
      f.answer.caseId = null;
      f.answer.recordRefs = [];
    }
    if (variant === "review") f.rows.set(financeReviewCases, []);
    if (variant === "transaction") f.rows.set(financeTransactions, []);
    if (variant === "affected-record") f.item.safeChanges = [];
    if (variant === "record-ref") f.answer.recordRefs = [{ kind: "review_case", id: f.caseId }];
    await expect(f.validate()).rejects.toMatchObject({ code: "conflict" });
  });
  async function priorQuestion(contextual: boolean) {
    const f = await fixture(),
      questionId = randomUUID();
    const question = {
      ...f.answer,
      id: randomUUID(),
      sequence: 1n,
      authorKind: "agent",
      sourceOperationId: randomUUID() as string | null,
      text: "Actual earlier canonical question",
      sourceMessageIds: [],
    };
    if (contextual) {
      question.recordRefs = [
        ...question.recordRefs,
        { kind: "contextual_question", id: questionId },
      ];
      f.answer.recordRefs = [
        ...f.answer.recordRefs,
        { kind: "contextual_question", id: questionId },
      ];
      f.rows.set(financeContextualQuestions, [{ id: questionId }]);
    }
    f.answer.sourceMessageIds = [question.id];
    f.answer.sourceOperationId = randomUUID();
    f.rows.set(financeConversationMessages, [question, f.answer]);
    f.claim.sourceMessageIds = [question.id, f.answer.id];
    f.rows.set(auditEvents, [{ id: randomUUID() }]);
    f.rows.set(financeReviewActionRequests, [{ id: randomUUID() }]);
    return { ...f, question };
  }
  it.each([
    false,
    true,
  ])("accepts only proven prior canonical question + delivered current answer, contextual=%s", async (contextual) => {
    const f = await priorQuestion(contextual);
    expect((await f.validate()).messages).toEqual([f.question, f.answer]);
  });
  it.each([
    "operation",
    "accepted-audit",
    "question",
    "creation-audit",
  ])("rejects unproven contextual answer/question %s", async (variant) => {
    const f = await priorQuestion(true);
    if (variant === "operation") f.answer.sourceOperationId = null;
    if (variant === "accepted-audit") f.rows.set(auditEvents, []);
    if (variant === "question") f.rows.set(financeContextualQuestions, []);
    if (variant === "creation-audit") f.queues.set(auditEvents, [[{ id: randomUUID() }], []]);
    await expect(f.validate()).rejects.toMatchObject({ code: "conflict" });
  });
  it.each([
    "unlinked",
    "case",
    "author",
    "operation",
    "question-ref",
  ])("rejects a foreign or noncanonical prior message %s", async (variant) => {
    const f = await priorQuestion(true);
    if (variant === "unlinked") f.answer.sourceMessageIds = [];
    if (variant === "case") f.question.caseId = randomUUID();
    if (variant === "author") f.question.authorKind = "user";
    if (variant === "operation") f.question.sourceOperationId = null;
    if (variant === "question-ref")
      f.answer.recordRefs = f.answer.recordRefs.filter((ref) => ref.kind !== "contextual_question");
    await expect(f.validate()).rejects.toMatchObject({ code: "conflict" });
  });
  it.each([
    "request",
    "answer-operation",
    "accepted-audit",
    "creation-audit",
  ])("does not manufacture prior ReviewCase lineage: %s", async (variant) => {
    const f = await priorQuestion(false);
    if (variant === "request") f.rows.set(financeReviewActionRequests, []);
    if (variant === "answer-operation") f.answer.sourceOperationId = null;
    if (variant === "accepted-audit") f.rows.set(auditEvents, []);
    if (variant === "creation-audit") f.queues.set(auditEvents, [[{ id: randomUUID() }], []]);
    await expect(f.validate()).rejects.toMatchObject({ code: "conflict" });
  });
  it("retains prior question / accepted answer linkage after live case FK clearing", async () => {
    const f = await priorQuestion(true);
    f.question.caseId = null;
    f.answer.caseId = null;
    expect((await f.validate()).messages).toEqual([f.question, f.answer]);
  });
  it("does not accept a contextual question when its owner-scoped review has disappeared", async () => {
    const f = await priorQuestion(true);
    f.rows.set(financeReviewCases, []);
    f.rows.set(financeContextualQuestions, []);
    await expect(f.validate()).rejects.toMatchObject({ code: "conflict" });
  });
});
