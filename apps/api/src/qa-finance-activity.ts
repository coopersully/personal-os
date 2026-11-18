import { createHash } from "node:crypto";
import type {
  auditEvents,
  financeMutationRecords,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import type { FinanceConversationEffectReceipt } from "@personal-os/domain";

/** Fictional, local-only history matching the demo's saved state; never executes financial actions. */
export function financeActivityFixture(userId: string, now: Date) {
  const id = (value: number) =>
    `${userId.slice(0, 8)}-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
  const runId = id(900);
  const stories = [
    {
      hours: 2,
      family: "account",
      kind: "finance_account",
      target: 400,
      action: "finance.account.updated",
      explanation:
        "Confirmed Everyday checking belongs entirely to me and is included in planning.",
      before: { ownershipType: "unknown", ownershipShare: null },
      after: { ownershipType: "individual", ownershipShare: 1 },
    },
    {
      hours: 3,
      family: "transaction",
      kind: "finance_transaction",
      target: 441,
      action: "finance.transaction.classified",
      explanation: "Categorized the Corner Cafe purchase as personal dining.",
      before: { category: null, needsReview: true },
      after: { category: "Dining", needsReview: false },
    },
    {
      hours: 5,
      family: "goal",
      kind: "finance_goal",
      target: 601,
      action: "finance.goal.updated",
      explanation: "Confirmed the emergency fund progress against the recorded savings balance.",
      before: { currentAmount: 1470000 },
      after: { currentAmount: 1520000 },
    },
    {
      hours: 26,
      family: "account",
      kind: "finance_account",
      target: 401,
      action: "finance.account.updated",
      explanation: "Included Emergency savings in the plan after confirming individual ownership.",
      before: { includeInPlanning: false },
      after: { includeInPlanning: true },
    },
    {
      hours: 24,
      family: "transaction",
      kind: "finance_transaction",
      target: 442,
      action: "finance.transaction.classified",
      explanation: "Confirmed the Neighborhood Market purchase belongs in Groceries.",
      before: { category: null, needsReview: true },
      after: { category: "Groceries", needsReview: false },
    },
  ];
  const audits: (typeof auditEvents.$inferInsert)[] = [];
  const mutations: (typeof financeMutationRecords.$inferInsert)[] = [];
  stories.forEach((story, index) => {
    const mutationId = id(910 + index),
      candidateId = id(920 + index),
      auditId = id(930 + index);
    const stamp = new Date(now.getTime() - story.hours * 3_600_000);
    const revision = `sha256:${createHash("sha256").update(JSON.stringify(story)).digest("hex")}`;
    const receipt: FinanceConversationEffectReceipt = {
      id: mutationId,
      runId,
      candidateId,
      candidateRevision: revision,
      automationScheduleId: null,
      authorizationConnectionId: null,
      committedAt: stamp.toISOString(),
      requestId: `finance-candidate-effect:${mutationId}`,
      originRequestId: `qa-finance-activity:${index}`,
      actor: { type: "user", id: userId },
      authorityBasis: "authenticated_owner",
      humanApproval: null,
      sourceMessageIds: [],
      explanation: story.explanation,
      auditEventIds: [auditId],
      recordRefs: [{ kind: story.kind, id: id(story.target) }],
      outcome: "committed",
      actionFamilies: [story.family],
      status: "applied",
      significance: "routine",
    };
    audits.push({
      id: auditId,
      userId,
      actorType: "user",
      actorId: userId,
      requestId: receipt.requestId,
      action: story.action,
      entityType: story.kind,
      entityId: id(story.target),
      before: story.before,
      after: story.after,
      createdAt: stamp,
    });
    mutations.push({
      id: mutationId,
      userId,
      idempotencyKey: `finance-candidate-effect:${candidateId}:${revision}`,
      operation: "commit_finance_candidate_effect_v1",
      requestHash: revision,
      actorType: "user",
      actorId: userId,
      status: "completed",
      response: { financeEffectReceipt: receipt },
      completedAt: stamp,
      createdAt: stamp,
      updatedAt: stamp,
    });
  });
  const runs: (typeof workspaceMaintenanceRuns.$inferInsert)[] = [
    {
      id: runId,
      userId,
      domain: "finances",
      scope: { type: "all_outstanding" },
      status: "completed",
      rulebookVersion: "1.0.0",
      createdAt: new Date(now.getTime() - 50 * 3_600_000),
      updatedAt: new Date(now.getTime() - 2 * 3_600_000),
    },
  ];
  return { audits, mutations, runs };
}
