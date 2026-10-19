import { randomUUID } from "node:crypto";
import {
  accessTokens,
  auditEvents,
  executionPolicySettings,
  financeConversationMessages,
  financeConversations,
  financeLedgerChallenges,
  type financeReviewActionRequests,
  type financeReviewCases,
  financeTransactions,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import { AppError } from "../errors.js";
import type { FinanceTransaction } from "./context.js";
import {
  mirrorAcceptedMaintenanceReviewAnswer,
  mirrorNewMaintenanceReviewQuestion,
} from "./conversation-review-mirror.js";

it("never turns agent settlement or a mismatched owner into a human answer", async () => {
  const input = {
    userId: "owner",
    actorId: "agent",
    actorType: "agent" as const,
    caseId: "case",
    transactionId: "transaction",
    requestId: "request",
    operationId: "operation",
    text: "Automated settlement is not an answer",
    recordedAt: new Date(),
  };
  expect(await mirrorAcceptedMaintenanceReviewAnswer({} as FinanceTransaction, input)).toBeNull();
  expect(
    await mirrorAcceptedMaintenanceReviewAnswer({} as FinanceTransaction, {
      ...input,
      actorType: "user",
      actorId: "other-owner",
    }),
  ).toBeNull();
});

function reviewFixture() {
  const userId = randomUUID(),
    actor = randomUUID(),
    runId = randomUUID(),
    caseId = randomUUID(),
    transactionId = randomUUID();
  const token = {
    id: actor,
    userId,
    scopes: ["finances:maintain", "finances:write", "finances:execute"],
    authorizationConnectionId: randomUUID(),
    expiresAt: null as Date | null,
    revokedAt: null as Date | null,
  };
  const challenge = { submittingAgentId: actor };
  const rows = new Map<unknown, unknown[]>([
    [financeLedgerChallenges, [challenge]],
    [accessTokens, [token]],
    [
      workspaceMaintenanceRuns,
      [{ id: runId, userId, authorizationConnectionId: null, automationScheduleId: null }],
    ],
    [executionPolicySettings, [{ reviewBypassEnabled: true }]],
    [financeTransactions, [{ id: transactionId, accountId: randomUUID() }]],
  ]);
  const queues = new Map<unknown, unknown[][]>(),
    failures = new Map<unknown, Error>();
  const inserted = new Map<unknown, Record<string, unknown>>(),
    omitted = new Set<unknown>();
  const query = (table: unknown) => {
    const chain = Object.assign(
      failures.has(table)
        ? Promise.reject(failures.get(table))
        : Promise.resolve(queues.get(table)?.shift() ?? rows.get(table) ?? []),
      {
        where: () => chain,
        for: () => chain,
        innerJoin: () => chain,
        limit: () => chain,
      },
    );
    return chain;
  };
  const tx = {
    select: () => ({ from: query }),
    insert: (table: unknown) => ({
      values: (value: Record<string, unknown>) => {
        inserted.set(table, value);
        const chain = Object.assign(Promise.resolve(), {
          onConflictDoUpdate: () => chain,
          returning: async () =>
            omitted.has(table) ? [] : [{ id: randomUUID(), nextSequence: 4n, ...value }],
        });
        return chain;
      },
    }),
  } as unknown as FinanceTransaction;
  const input = {
    userId,
    runId,
    candidateId: randomUUID(),
    candidateItemId: randomUUID(),
    candidateRevision: `sha256:${"a".repeat(64)}`,
    review: { id: caseId, transactionId } as typeof financeReviewCases.$inferSelect,
    request: {
      id: randomUUID(),
      authorityOperationId: randomUUID(),
      prompt: "Actual new question",
      createdAt: new Date(),
      actionRevision: 2n,
    } as typeof financeReviewActionRequests.$inferSelect,
    requestId: randomUUID(),
  };
  const answer = {
    userId,
    actorType: "user" as const,
    actorId: userId,
    caseId,
    transactionId,
    requestId: input.request.id,
    operationId: randomUUID(),
    text: "Actual accepted answer",
    recordedAt: new Date(),
  };
  return { rows, queues, failures, inserted, omitted, tx, input, answer, token, challenge };
}
describe("canonical ReviewCase conversation provenance", () => {
  it.each([
    "missing",
    "null",
    "legacy",
  ])("does not mirror unprovable submitting agent %s", async (variant) => {
    const f = reviewFixture();
    f.rows.set(
      financeLedgerChallenges,
      variant === "missing"
        ? []
        : [{ submittingAgentId: variant === "null" ? null : "legacy-synthetic-agent" }],
    );
    expect(await mirrorNewMaintenanceReviewQuestion(f.tx, f.input)).toBeNull();
    expect(f.inserted.size).toBe(0);
  });
  it.each([
    "token",
    "run",
    "transaction",
  ])("leaves unavailable canonical source %s absent rather than backfilling", async (variant) => {
    const f = reviewFixture();
    f.rows.set(
      variant === "token"
        ? accessTokens
        : variant === "run"
          ? workspaceMaintenanceRuns
          : financeTransactions,
      [],
    );
    expect(await mirrorNewMaintenanceReviewQuestion(f.tx, f.input)).toBeNull();
    expect(f.inserted.size).toBe(0);
  });
  it.each(["policy", "scope"])("skips a question mirror after current %s loss", async (variant) => {
    const f = reviewFixture();
    if (variant === "policy") f.rows.set(executionPolicySettings, []);
    else f.token.scopes = ["finances:maintain"];
    expect(await mirrorNewMaintenanceReviewQuestion(f.tx, f.input)).toBeNull();
    expect(f.inserted.size).toBe(0);
  });
  it.each([
    new Error("storage failed"),
    new AppError("internal_error", "storage failed"),
  ])("propagates unexpected authority errors", async (error) => {
    const f = reviewFixture();
    f.failures.set(executionPolicySettings, error);
    await expect(mirrorNewMaintenanceReviewQuestion(f.tx, f.input)).rejects.toBe(error);
    expect(f.inserted.size).toBe(0);
  });
  it("mirrors only actual new canonical prompt and records exact creation audit actor/request/operation", async () => {
    const f = reviewFixture();
    const result = await mirrorNewMaintenanceReviewQuestion(f.tx, f.input);
    expect(result).toMatchObject({
      text: f.input.request.prompt,
      sourceOperationId: f.input.request.authorityOperationId,
      createdAt: f.input.request.createdAt,
      idempotencyKey: `review-question:${f.input.review.id}:${f.input.candidateItemId}:${f.input.candidateRevision}:2`,
    });
    expect(f.inserted.get(auditEvents)).toMatchObject({
      actorType: "agent",
      actorId: f.token.id,
      requestId: f.input.requestId,
      action: "finance.review_question.created",
      after: {
        operationId: f.input.request.authorityOperationId,
        requestId: f.input.request.id,
        prompt: f.input.request.prompt,
        actionRevision: "2",
      },
    });
  });
  it.each([
    true,
    false,
  ])("records accepted human text with only proven prior question link present=%s", async (present) => {
    const f = reviewFixture(),
      questionId = randomUUID();
    f.queues.set(financeConversationMessages, [present ? [{ id: questionId }] : [], []]);
    const result = await mirrorAcceptedMaintenanceReviewAnswer(f.tx, f.answer);
    expect(result).toMatchObject({
      text: f.answer.text,
      sourceOperationId: f.answer.operationId,
      createdAt: f.answer.recordedAt,
      sourceMessageIds: present ? [questionId] : [],
      authorKind: "user",
    });
  });
  it("replays identical accepted owner evidence without another message", async () => {
    const f = reviewFixture();
    const existing = {
      id: randomUUID(),
      sourceOperationId: f.answer.operationId,
      caseId: null,
      recordRefs: [{ kind: "review_case", id: f.answer.caseId }],
      text: f.answer.text,
    };
    f.queues.set(financeConversationMessages, [[], [existing]]);
    expect(await mirrorAcceptedMaintenanceReviewAnswer(f.tx, f.answer)).toBe(existing);
    expect(f.inserted.size).toBe(0);
  });
  it.each([
    financeConversations,
    financeConversationMessages,
  ])("rejects lost accepted-answer persistence rather than inventing history", async (table) => {
    const f = reviewFixture();
    f.omitted.add(table);
    await expect(mirrorAcceptedMaintenanceReviewAnswer(f.tx, f.answer)).rejects.toMatchObject({
      code: "internal_error",
    });
  });
  it("does not mirror a new question from an expired original bound submitting credential", async () => {
    const f = reviewFixture();
    f.token.expiresAt = new Date(0);
    f.rows.set(workspaceMaintenanceRuns, [
      {
        id: f.input.runId,
        userId: f.input.userId,
        authorizationConnectionId: f.token.authorizationConnectionId,
        automationScheduleId: randomUUID(),
      },
    ]);
    expect(await mirrorNewMaintenanceReviewQuestion(f.tx, f.input)).toBeNull();
    expect(f.inserted.size).toBe(0);
  });
});
