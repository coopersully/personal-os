import { createHash } from "node:crypto";
import type { Database } from "@personal-os/database";
import { describe, expect, it } from "vitest";
import {
  createFinanceActivityService,
  decodeFinanceActivityCursor,
  encodeFinanceActivityCursor,
  type FinanceActivityDecisionSource,
  projectFinanceActivityDecision,
} from "./activity-service.js";

const owner = "11111111-1111-4111-8111-111111111111";
const operation = "22222222-2222-4222-8222-222222222222";
const question = "33333333-3333-4333-8333-333333333333";
const caseId = "44444444-4444-4444-8444-444444444444";
const messageId = "55555555-5555-4555-8555-555555555555";
const auditId = "66666666-6666-4666-8666-666666666666";
const answerId = "77777777-7777-4777-8777-777777777777";
const stamp = new Date("2026-10-18T12:00:00Z");
function source(): FinanceActivityDecisionSource {
  return {
    audit: {
      id: auditId,
      userId: owner,
      actorType: "user",
      actorId: owner,
      requestId: "owner-answer",
      action: "finance.contextual_answer.accepted",
      entityType: "finance_contextual_question",
      entityId: question,
      before: { revision: "1", actionRevision: "1" },
      after: { answerId, revision: "2", operationId: operation, state: "accepted" },
      createdAt: stamp,
    },
    message: {
      id: messageId,
      userId: owner,
      sequence: 9007199254740993n,
      authorKind: "user",
      text: "Lunch with a friend",
      caseId,
      caseOwnerId: owner,
      recordRefs: [
        { kind: "contextual_question", id: question },
        { kind: "review_case", id: caseId },
      ],
      sourceMessageIds: [],
      runId: null,
      sourceOperationId: operation,
      idempotencyKey: `answer:${operation}`,
      createdAt: stamp,
    },
    receipt: {
      id: operation,
      userId: owner,
      idempotencyKey: operation,
      operation: "answer_contextual_question_v1",
      requestHash: "server-hash",
      actorType: "user",
      actorId: owner,
      status: "completed",
      response: { state: "accepted", operationId: operation, resultRevision: "2" },
      error: null,
      completedAt: stamp,
      leaseExpiresAt: null,
      createdAt: stamp,
      updatedAt: stamp,
    },
    answer: {
      id: answerId,
      userId: owner,
      questionId: question,
      operationId: operation,
      answeredWorkRevision: 1n,
      answeredActionRevision: 1n,
      resultingWorkRevision: 2n,
      text: "Lunch with a friend",
      sourceKind: "app",
      sourceMessageId: null,
      sourceReplyBindingId: null,
      actorType: "user",
      actorId: owner,
      requestId: "owner-answer",
      recordedAt: stamp,
    },
  };
}
describe("Finance Activity causal read projection", () => {
  it("projects accepted human judgment with exact immutable source, never an applied money change", () => {
    const entry = projectFinanceActivityDecision(owner, source());
    expect(entry).toMatchObject({
      id: auditId,
      kind: "human_answer_decision",
      status: "accepted",
      actionId: operation,
      sourceOperationId: operation,
      caseId,
      runId: null,
      auditEventIds: [auditId],
      changes: [],
    });
    expect(entry?.sourceMessages[0]).toMatchObject({
      id: messageId,
      sequence: "9007199254740993",
      text: "Lunch with a friend",
      excerpt: null,
      contentHash: createHash("sha256").update("Lunch with a friend").digest("hex"),
    });
    expect(entry?.targets).toContainEqual({ kind: "chat", id: messageId });
  });
  it("retains a provable historical decision after live question/answer/case deletion", () => {
    const original = source();
    const deleted = {
      ...original,
      answer: null,
      message: { ...original.message, caseId: null, caseOwnerId: null },
    };
    expect(projectFinanceActivityDecision(owner, deleted)).toEqual(
      projectFinanceActivityDecision(owner, original),
    );
  });
  it("omits foreign, unaccepted, unreceipted and mismatched canonical evidence", () => {
    const current = source();
    if (!current.answer) throw new Error("Missing test answer");
    const invalid: FinanceActivityDecisionSource[] = [
      { ...current, audit: { ...current.audit, userId: operation } },
      { ...current, message: { ...current.message, userId: operation } },
      { ...current, receipt: { ...current.receipt, userId: operation } },
      { ...current, audit: { ...current.audit, actorId: operation } },
      { ...current, receipt: { ...current.receipt, status: "failed" } },
      {
        ...current,
        receipt: {
          ...current.receipt,
          response: { state: "accepted", operationId: question, resultRevision: "2" },
        },
      },
      { ...current, message: { ...current.message, recordRefs: [] } },
      {
        ...current,
        audit: { ...current.audit, after: { ...current.audit.after, state: "proposed" } },
      },
      { ...current, answer: { ...current.answer, requestId: "unrelated-request" } },
      {
        ...current,
        message: { ...current.message, authorKind: "agent", text: "I changed your budget" },
      },
    ];
    for (const candidate of invalid)
      expect(projectFinanceActivityDecision(owner, candidate)).toBeNull();
  });
  it("rejects cursor tampering, cross-owner reuse and every filter change", () => {
    const query = {
      limit: 10,
      type: "human_answer_decision" as const,
      actor: "user" as const,
      recordId: caseId,
      from: "2026-10-01T00:00:00Z",
      through: "2026-10-30T00:00:00Z",
    };
    const cursor = encodeFinanceActivityCursor(
      owner,
      query,
      { at: "2026-10-18T12:00:00.123456Z", id: auditId },
      "existing-server-key",
    );
    expect(
      decodeFinanceActivityCursor(owner, { ...query, cursor }, "existing-server-key")?.id,
    ).toBe(auditId);
    expect(
      decodeFinanceActivityCursor(owner, { ...query, cursor }, "existing-server-key")?.at,
    ).toBe("2026-10-18T12:00:00.123456Z");
    expect(() =>
      decodeFinanceActivityCursor(operation, { ...query, cursor }, "existing-server-key"),
    ).toThrow("exact filters");
    for (const changed of [
      { ...query, actor: "agent" as const },
      { ...query, type: "financial_action" as const },
      { ...query, recordId: operation },
      { ...query, from: "2026-10-02T00:00:00Z" },
      { ...query, through: "2026-10-29T00:00:00Z" },
    ])
      expect(() =>
        decodeFinanceActivityCursor(owner, { ...changed, cursor }, "existing-server-key"),
      ).toThrow("exact filters");
    expect(() =>
      decodeFinanceActivityCursor(
        owner,
        { ...query, cursor: `${cursor}altered` },
        "existing-server-key",
      ),
    ).toThrow("exact filters");
    expect(() => decodeFinanceActivityCursor(owner, { ...query, cursor }, "another-key")).toThrow(
      "exact filters",
    );
  });
  it("returns honest unavailable effects without querying messages, pending queues or model replies", async () => {
    const service = createFinanceActivityService({
      db: {} as Database,
      cursorSecret: "server-key",
    });
    const result = await service.listActivity(owner, { limit: 50, type: "financial_action" });
    expect(result.entries).toEqual([]);
    expect(result.capabilities.financialActions).toEqual({
      state: "unavailable",
      reason: "mutation_evidence_not_integrated",
    });
    expect(result.coverage.state).toBe("partial");
  });
});
