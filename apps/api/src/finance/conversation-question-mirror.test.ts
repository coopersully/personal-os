import { randomUUID } from "node:crypto";
import {
  accessTokens,
  type Database,
  executionPolicySettings,
  financeConversationMessages,
  financeConversations,
} from "@personal-os/database";
import { mirrorCreatedFinanceQuestion } from "./conversation-question-mirror.js";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
function fixture() {
  const owner = randomUUID(),
    actor = randomUUID(),
    at = new Date();
  const principal = {
    userId: owner,
    actorId: actor,
    actorType: "agent" as const,
    scopes: new Set(["finances:write", "finances:execute"] as const),
  };
  const input = {
    questionId: randomUUID(),
    caseId: randomUUID(),
    transactionId: randomUUID(),
    accountId: randomUUID(),
    operationId: randomUUID(),
    prompt: "What was this purchase for?",
    createdAt: at,
  };
  const token = {
    id: actor,
    userId: owner,
    scopes: [...principal.scopes],
    revokedAt: null as Date | null,
    expiresAt: null as Date | null,
  };
  const rows = new Map<unknown, unknown[]>([
    [accessTokens, [token]],
    [executionPolicySettings, [{ reviewBypassEnabled: true }]],
  ]);
  const omitted = new Set<unknown>(),
    inserted = new Map<unknown, Record<string, unknown>>();
  const failures = new Map<unknown, Error>();
  const query = (table: unknown) => {
    const chain = Object.assign(Promise.resolve(rows.get(table) ?? []), {
      where: () => chain,
      for: () => chain,
      limit: () => chain,
    });
    return chain;
  };
  const tx = {
    select: () => ({ from: query }),
    insert: (table: unknown) => ({
      values: (value: Record<string, unknown>) => {
        inserted.set(table, value);
        const chain = {
          onConflictDoUpdate: () => chain,
          returning: async () => {
            if (failures.has(table)) throw failures.get(table);
            return omitted.has(table) ? [] : [{ id: randomUUID(), nextSequence: 7n, ...value }];
          },
        };
        return chain;
      },
    }),
  } as unknown as Tx;
  return { principal, input, token, rows, omitted, inserted, failures, tx };
}
describe("canonical new question message mirror", () => {
  it("never claims owner-authored or synthetic system questions as authenticated agent speech", async () => {
    const f = fixture();
    expect(
      await mirrorCreatedFinanceQuestion(
        f.tx,
        { ...f.principal, actorType: "user", actorId: f.principal.userId },
        f.input,
      ),
    ).toBeNull();
    expect(f.inserted.size).toBe(0);
  });
  it.each([
    "write",
    "execute",
    "revoked",
    "expired",
    "missing",
    "policy",
  ])("requires actual current %s authority", async (variant) => {
    const f = fixture();
    if (variant === "write") f.token.scopes = ["finances:execute"];
    if (variant === "execute") f.token.scopes = ["finances:write"];
    if (variant === "revoked") f.token.revokedAt = f.input.createdAt;
    if (variant === "expired") f.token.expiresAt = f.input.createdAt;
    if (variant === "missing") f.rows.set(accessTokens, []);
    if (variant === "policy") f.rows.set(executionPolicySettings, []);
    await expect(mirrorCreatedFinanceQuestion(f.tx, f.principal, f.input)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(f.inserted.size).toBe(0);
  });
  it("requires a canonical identity instead of inventing a retrospective question", async () => {
    const f = fixture();
    const { questionId: _questionId, ...input } = f.input;
    await expect(mirrorCreatedFinanceQuestion(f.tx, f.principal, input)).rejects.toMatchObject({
      code: "internal_error",
    });
    expect(f.inserted.size).toBe(0);
  });
  it("records exact new question text, original actor operation, time and record provenance once", async () => {
    const f = fixture();
    const result = await mirrorCreatedFinanceQuestion(f.tx, f.principal, f.input);
    expect(result).toMatchObject({
      text: f.input.prompt,
      createdAt: f.input.createdAt,
      sourceOperationId: f.input.operationId,
      authorKind: "agent",
      caseOwnerId: f.principal.userId,
      idempotencyKey: `question:${f.input.questionId}:1`,
      sourceMessageIds: [],
      recordRefs: [
        { kind: "contextual_question", id: f.input.questionId },
        { kind: "review_case", id: f.input.caseId },
        { kind: "transaction", id: f.input.transactionId },
        { kind: "account", id: f.input.accountId },
      ],
    });
  });
  it("uses stable canonical ReviewCase identity without fabricating a contextual question ID", async () => {
    const f = fixture();
    const { questionId: _questionId, ...input } = f.input;
    const result = await mirrorCreatedFinanceQuestion(f.tx, f.principal, {
      ...input,
      idempotencyKey: "review-question:canonical-case-item-revision",
    });
    expect(result?.recordRefs.map((ref) => ref.kind)).toEqual([
      "review_case",
      "transaction",
      "account",
    ]);
    expect(result?.idempotencyKey).toBe("review-question:canonical-case-item-revision");
  });
  it.each([
    "exact",
    "operation",
    "prompt",
  ])("reuses only identical creation evidence: %s", async (variant) => {
    const f = fixture();
    const existing = {
      id: randomUUID(),
      sourceOperationId: variant === "operation" ? randomUUID() : f.input.operationId,
      text: variant === "prompt" ? "Different" : f.input.prompt,
    };
    f.rows.set(financeConversationMessages, [existing]);
    const result = mirrorCreatedFinanceQuestion(f.tx, f.principal, f.input);
    if (variant === "exact") expect(await result).toBe(existing);
    else await expect(result).rejects.toMatchObject({ code: "conflict" });
    expect(f.inserted.size).toBe(0);
  });
  it.each([
    financeConversations,
    financeConversationMessages,
  ])("rejects missing storage results without reporting a mirrored question", async (table) => {
    const f = fixture();
    f.omitted.add(table);
    await expect(mirrorCreatedFinanceQuestion(f.tx, f.principal, f.input)).rejects.toMatchObject({
      code: "internal_error",
    });
    if (table === financeConversations)
      expect(f.inserted.has(financeConversationMessages)).toBe(false);
  });
  it("propagates a transaction write failure instead of accepting fabricated history", async () => {
    const f = fixture(),
      failure = new Error("storage failed");
    f.failures.set(financeConversationMessages, failure);
    await expect(mirrorCreatedFinanceQuestion(f.tx, f.principal, f.input)).rejects.toBe(failure);
  });
});
