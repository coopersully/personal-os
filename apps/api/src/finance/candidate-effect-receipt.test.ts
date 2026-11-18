import {
  financeConversationCausalClaimSchema,
  financeConversationEffectReceiptSchema,
} from "@personal-os/domain";
import { describe, expect, it } from "vitest";
import { requireBudgetApproval } from "./budget-authority.js";
import { financeCandidateEffectKey } from "./candidate-effect-receipt.js";
import {
  decodeEffectEvidenceCursor,
  effectEvidenceCursor,
} from "./conversation-evidence-service.js";

const owner = "11111111-1111-4111-8111-111111111111";
const candidate = "22222222-2222-4222-8222-222222222222";
const revision = `sha256:${"a".repeat(64)}`;
describe("Finance effect lineage contracts", () => {
  it("never accepts authority labels, duplicate/fictitious empty sources or unbounded explanations as causal evidence", () => {
    expect(
      financeConversationCausalClaimSchema.parse({
        sourceMessageIds: [candidate],
        explanation: "Use this exact answer",
      }).sourceMessageIds,
    ).toEqual([candidate]);
    for (const value of [
      { sourceMessageIds: [], explanation: "empty" },
      { sourceMessageIds: [candidate, candidate], explanation: "duplicate" },
      { sourceMessageIds: [candidate], explanation: "x".repeat(4001) },
      { sourceMessageIds: [candidate], explanation: "approved", humanApproved: true },
    ])
      expect(financeConversationCausalClaimSchema.safeParse(value).success).toBe(false);
  });
  it("binds effect receipt identity to exact candidate revision and evidence cursors to original owner/run/action", () => {
    const key = financeCandidateEffectKey(candidate, revision);
    expect(key).not.toBe(financeCandidateEffectKey(candidate, `sha256:${"b".repeat(64)}`));
    const cursor = effectEvidenceCursor(owner, candidate, key, 100, "existing-key");
    expect(decodeEffectEvidenceCursor(cursor, owner, candidate, key, "existing-key")).toBe(100);
    for (const args of [
      [candidate, candidate, key, "existing-key"],
      [owner, owner, key, "existing-key"],
      [owner, candidate, `${key}changed`, "existing-key"],
      [owner, candidate, key, "wrong-key"],
    ] as const)
      expect(() => decodeEffectEvidenceCursor(cursor, args[0], args[1], args[2], args[3])).toThrow(
        "exact",
      );
    expect(() =>
      decodeEffectEvidenceCursor(`${cursor}tampered`, owner, candidate, key, "existing-key"),
    ).toThrow("exact");
  });
  it("keeps empty autonomous chat lineage distinct from approval and requires exact receipt provenance fields", () => {
    const receipt = {
      id: candidate,
      runId: owner,
      candidateId: candidate,
      candidateRevision: revision,
      automationScheduleId: null,
      authorizationConnectionId: null,
      committedAt: "2026-10-18T00:00:00Z",
      requestId: "server-effect-id",
      originRequestId: "original-request",
      actor: { type: "agent", id: candidate },
      authorityBasis: "legacy_unbound_context",
      humanApproval: null,
      sourceMessageIds: [],
      explanation: "Authorized autonomous operation",
      auditEventIds: [],
      recordRefs: [],
      outcome: "committed",
      actionFamilies: ["transaction"],
      status: "no_changes",
      significance: "routine",
    };
    expect(financeConversationEffectReceiptSchema.parse(receipt).sourceMessageIds).toEqual([]);
    expect(() =>
      requireBudgetApproval({
        userId: owner,
        actorId: candidate,
        actorType: "agent",
        scopes: new Set(["finances:write", "finances:execute", "finances:maintain"]),
      }),
    ).toThrow();
    expect(
      financeConversationEffectReceiptSchema.safeParse({
        ...receipt,
        humanApproval: { actorId: "agent-said-so", reviewId: candidate },
      }).success,
    ).toBe(false);
  });
});
