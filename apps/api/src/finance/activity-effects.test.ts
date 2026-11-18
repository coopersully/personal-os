import type { FinanceConversationEffectReceipt } from "@personal-os/domain";
import { describe, expect, it } from "vitest";
import {
  decodeFinanceActivityEvidenceCursor,
  encodeFinanceActivityEvidenceCursor,
  type FinanceActivityEffectSource,
  financeActivityRecordRef,
  projectFinanceActivityEffect,
  projectFinanceActivityEvidence,
  readFinanceActivityReceipt,
} from "./activity-effects.js";

const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const owner = id(1),
  stamp = new Date("2026-10-18T10:00:00Z"),
  secret = "activity-test-secret";
export function effectSource(count = 1): FinanceActivityEffectSource {
  const audits = Array.from({ length: count }, (_, index) => ({
    id: id(100 + index),
    userId: owner,
    actorType: "agent" as const,
    actorId: id(2),
    requestId: `finance-candidate-effect:${id(3)}`,
    action: "finance.transaction.classified",
    entityType: "finance_transaction",
    entityId: id(10000 + index),
    before: { category: "Uncategorized" },
    after: { category: "Food" },
    createdAt: stamp,
  }));
  const receipt: FinanceConversationEffectReceipt = {
    id: id(3),
    runId: id(4),
    candidateId: id(5),
    candidateRevision: `sha256:${"a".repeat(64)}`,
    automationScheduleId: id(6),
    authorizationConnectionId: id(7),
    committedAt: stamp.toISOString(),
    requestId: `finance-candidate-effect:${id(3)}`,
    originRequestId: "original-request",
    actor: { type: "agent", id: id(2) },
    authorityBasis: "original_live_grant",
    humanApproval: null,
    sourceMessageIds: [],
    explanation: "Applied authorized transaction classifications",
    auditEventIds: audits.map((audit) => audit.id),
    recordRefs: audits.map((audit) => ({ kind: audit.entityType, id: audit.entityId })),
    outcome: "committed",
    actionFamilies: ["transaction"],
    status: "applied",
    significance: "routine",
  };
  return {
    receipt,
    audits,
    messages: [],
    causalEvidence: null,
    mutation: {
      id: receipt.id,
      userId: owner,
      idempotencyKey: `finance-candidate-effect:${receipt.candidateId}:${receipt.candidateRevision}`,
      operation: "commit_finance_candidate_effect_v1",
      requestHash: "server-hash",
      actorType: "agent",
      actorId: id(2),
      status: "completed",
      response: { financeEffectReceipt: receipt },
      error: null,
      completedAt: stamp,
      leaseExpiresAt: null,
      createdAt: stamp,
      updatedAt: stamp,
    },
  };
}
describe("actual Finance Activity effect evidence", () => {
  it("projects only an actual completed receipt and exact correlated audits", () => {
    const source = effectSource();
    const firstAudit = source.audits[0];
    if (!firstAudit) throw new Error("audit fixture");
    const entry = projectFinanceActivityEffect(owner, source, secret);
    expect(entry?.kind).toBe("financial_action");
    expect(entry?.status).toBe("applied");
    expect(entry?.changes[0]).toMatchObject({
      before: { category: "Uncategorized" },
      after: { category: "Food" },
      sourceRecordRef: { kind: "finance_transaction" },
      recordRef: { kind: "transaction" },
    });
    expect(entry?.effect?.humanApproval).toBeNull();
    expect(entry?.sourceMessages).toEqual([]);
    for (const mutation of [
      { ...source.mutation, userId: id(9) },
      { ...source.mutation, actorId: id(9) },
      { ...source.mutation, status: "failed" as const },
      { ...source.mutation, idempotencyKey: "unrelated" },
      {
        ...source.mutation,
        response: {
          financeEffectReceipt: { ...source.receipt, status: "no_changes", auditEventIds: [] },
        },
      },
    ])
      expect(readFinanceActivityReceipt(owner, mutation)).toBeNull();
    expect(
      projectFinanceActivityEffect(
        owner,
        { ...source, audits: [{ ...firstAudit, requestId: "caller-supplied" }] },
        secret,
      ),
    ).toBeNull();
    expect(projectFinanceActivityEffect(owner, { ...source, audits: [] }, secret)).toBeNull();
  });
  it("pages 101 exact changes without truncating completeness or duplicating an action", () => {
    const source = effectSource(101);
    const first = projectFinanceActivityEffect(owner, source, secret);
    expect(first?.changes).toHaveLength(100);
    expect(first?.evidence).toMatchObject({ totalChanges: 101, loadedChanges: 100 });
    const cursor = first?.evidence?.nextCursor;
    expect(cursor).toBeTruthy();
    const offset = decodeFinanceActivityEvidenceCursor(
      owner,
      source.receipt,
      cursor ?? undefined,
      secret,
    );
    expect(offset).toBe(100);
    const last = projectFinanceActivityEvidence(owner, source, offset, secret);
    expect(last).toMatchObject({
      entryId: source.receipt.id,
      offset: 100,
      totalChanges: 101,
      nextCursor: null,
    });
    expect(last?.changes).toHaveLength(1);
    expect(last?.changes[0]?.id).not.toBe(first?.changes[0]?.id);
  });
  it("bounds the maximum 10,000-change receipt and rejects overflow", () => {
    const source = effectSource(10000);
    expect(projectFinanceActivityEvidence(owner, source, 9900, secret)?.changes).toHaveLength(100);
    const overflow = effectSource(10001);
    expect(readFinanceActivityReceipt(owner, overflow.mutation)).toBeNull();
  });
  it("rejects owner/entry/revision/content/tampered evidence cursors rather than restarting", () => {
    const source = effectSource(101);
    const cursor = encodeFinanceActivityEvidenceCursor(owner, source.receipt, 100, secret);
    for (const [otherOwner, receipt, value] of [
      [id(9), source.receipt, cursor],
      [owner, { ...source.receipt, id: id(9) }, cursor],
      [owner, { ...source.receipt, candidateRevision: `sha256:${"b".repeat(64)}` }, cursor],
      [owner, { ...source.receipt, explanation: "changed" }, cursor],
      [owner, source.receipt, `${cursor}x`],
    ] as const)
      expect(() => decodeFinanceActivityEvidenceCursor(otherOwner, receipt, value, secret)).toThrow(
        "exact Activity evidence cursor",
      );
  });
  it("requires immutable owned exact causal sources and preserves bigint identities", () => {
    const source = effectSource();
    source.receipt.sourceMessageIds = [id(10)];
    source.messages = [
      {
        id: id(10),
        userId: owner,
        sequence: 9223372036854775807n,
        authorKind: "user",
        text: "Immutable original",
        caseId: null,
        caseOwnerId: null,
        recordRefs: [],
        sourceMessageIds: [],
        runId: null,
        sourceOperationId: null,
        idempotencyKey: "manual-source",
        createdAt: stamp,
      },
    ];
    source.causalEvidence = {
      id: id(11),
      userId: owner,
      runId: source.receipt.runId,
      caseId: null,
      caseOwnerId: null,
      sourceContext: { caseId: null },
      actionKey: source.mutation.idempotencyKey,
      sourceOperationId: source.receipt.candidateId,
      sourceMessageIds: source.receipt.sourceMessageIds,
      explanation: source.receipt.explanation,
      effectRefs: [],
      createdAt: stamp,
    };
    expect(projectFinanceActivityEffect(owner, source, secret)?.sourceMessages[0]).toMatchObject({
      text: "Immutable original",
      sequence: "9223372036854775807",
      excerpt: null,
    });
    expect(
      projectFinanceActivityEffect(owner, { ...source, causalEvidence: null }, secret),
    ).toBeNull();
    const firstMessage = source.messages[0];
    if (!firstMessage) throw new Error("message fixture");
    expect(
      projectFinanceActivityEffect(
        owner,
        { ...source, messages: [{ ...firstMessage, userId: id(9) }] },
        secret,
      ),
    ).toBeNull();
    expect(projectFinanceActivityEffect(owner, { ...source, messages: [] }, secret)).toBeNull();
  });
  it("preserves raw unknown records and exact human approval without inferred attribution", () => {
    expect(financeActivityRecordRef({ kind: "finance_budget_plan", id: id(9) })).toEqual({
      kind: "finance_budget_plan",
      id: id(9),
      sourceKind: "finance_budget_plan",
    });
    const source = effectSource();
    source.receipt.significance = "budget_decision";
    source.receipt.actionFamilies = ["budget_plan", "transaction"];
    source.receipt.humanApproval = { actorId: owner, reviewId: id(12) };
    expect(projectFinanceActivityEffect(owner, source, secret)?.effect).toMatchObject({
      significance: "budget_decision",
      humanApproval: { actorId: owner, reviewId: id(12) },
    });
  });
});
