import {
  auditEvents,
  type Database,
  financeConversationBatches,
  type financeMaintenanceCandidateItems,
  financeMutationRecords,
  type workspaceMaintenanceRuns,
} from "@personal-os/database";
import {
  type FinanceConversationCausalClaim,
  type FinanceConversationEffectReceipt,
  financeConversationEffectReceiptSchema,
} from "@personal-os/domain";
import { and, eq } from "drizzle-orm";
import { AppError } from "../errors.js";
import type { Principal } from "../types.js";
import { executeFinanceIdempotently, loadFinanceAuthorization } from "./context.js";
import { validateFinanceConversationClaim } from "./conversation-causality.js";
import { commitFinanceConversationEvidence } from "./conversation-evidence.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export function financeCandidateEffectKey(candidateId: string, revision: string) {
  return `finance-candidate-effect:${candidateId}:${revision}`;
}

/** Reuses the canonical Finance idempotency protocol inside the existing effect transaction. */
export async function commitFinanceCandidateEffects(input: {
  db: Database;
  tx: Transaction;
  run: typeof workspaceMaintenanceRuns.$inferSelect;
  candidateId: string;
  candidateRevision: string;
  principal: Principal;
  requestId: string;
  items: ReadonlyArray<typeof financeMaintenanceCandidateItems.$inferSelect>;
  claim?: FinanceConversationCausalClaim;
  humanApproval?: { principal: Principal; reviewId: string };
  now: Date;
  applyEffects: (effectRequestId: string) => Promise<void>;
}): Promise<FinanceConversationEffectReceipt> {
  const { tx, run, principal, claim } = input;
  if (claim)
    await validateFinanceConversationClaim(tx, run, principal, input.items, claim, input.now);
  const key = financeCandidateEffectKey(input.candidateId, input.candidateRevision);
  const authority = await loadFinanceAuthorization({
    db: tx,
    principal,
    requestId: input.requestId,
  });
  const response = await executeFinanceIdempotently(
    input.db,
    authority,
    {
      idempotencyKey: key,
      operation: "commit_finance_candidate_effect_v1",
      payload: {
        candidateId: input.candidateId,
        candidateRevision: input.candidateRevision,
        runId: run.id,
        claim: claim ?? null,
        humanApproval: input.humanApproval
          ? {
              actorId: input.humanApproval.principal.actorId,
              reviewId: input.humanApproval.reviewId,
            }
          : null,
      },
    },
    async () => {
      const [record] = await tx
        .select({ id: financeMutationRecords.id })
        .from(financeMutationRecords)
        .where(
          and(
            eq(financeMutationRecords.userId, run.userId),
            eq(financeMutationRecords.idempotencyKey, key),
          ),
        );
      if (!record)
        throw new AppError("internal_error", "The canonical financial receipt was not admitted.");
      const effectRequestId = `finance-candidate-effect:${record.id}`;
      const auditScope = and(
        eq(auditEvents.userId, run.userId),
        eq(auditEvents.requestId, effectRequestId),
      );
      const previous = new Set(
        (await tx.select({ id: auditEvents.id }).from(auditEvents).where(auditScope)).map(
          (row) => row.id,
        ),
      );
      let newAudits: Array<typeof auditEvents.$inferSelect> = [];
      const apply = async () => {
        await input.applyEffects(effectRequestId);
        newAudits = (await tx.select().from(auditEvents).where(auditScope)).filter(
          (row) => !previous.has(row.id),
        );
        if (newAudits.length > 10000)
          throw new AppError("conflict", "The candidate exceeds the bounded evidence receipt.");
        return [
          ...newAudits.map((audit) => ({ kind: "audit_event", id: audit.id })),
          ...newAudits.map((audit) => ({ kind: audit.entityType, id: audit.entityId })),
        ];
      };
      const [batch] = await tx
        .select({ runId: financeConversationBatches.runId })
        .from(financeConversationBatches)
        .where(
          and(
            eq(financeConversationBatches.userId, run.userId),
            eq(financeConversationBatches.runId, run.id),
          ),
        );
      const explanation =
        claim?.explanation ?? "Committed the authorized Finance maintenance candidate.";
      if (batch) {
        const evidence = await commitFinanceConversationEvidence(
          tx,
          principal,
          {
            runId: run.id,
            caseId: null,
            actionKey: key,
            sourceOperationId: input.candidateId,
            sourceMessageIds: claim?.sourceMessageIds ?? [],
            explanation,
          },
          apply,
          input.now,
          {
            candidateItems: input.items,
            ...(input.humanApproval ? { humanApproval: input.humanApproval } : {}),
          },
        );
        if (evidence.replayed)
          throw new AppError(
            "conflict",
            "Financial evidence exists without its canonical receipt.",
          );
      } else await apply();
      const actionFamilies = [...new Set(input.items.map((item) => item.actionKind))];
      const recordRefs = [
        ...new Map(
          newAudits.map((audit) => [
            `${audit.entityType}:${audit.entityId}`,
            { kind: audit.entityType, id: audit.entityId },
          ]),
        ).values(),
      ];
      const receipt = financeConversationEffectReceiptSchema.parse({
        id: record.id,
        runId: run.id,
        candidateId: input.candidateId,
        candidateRevision: input.candidateRevision,
        automationScheduleId: run.automationScheduleId,
        authorizationConnectionId: run.authorizationConnectionId,
        committedAt: input.now.toISOString(),
        requestId: effectRequestId,
        originRequestId: input.requestId,
        actor: { type: principal.actorType, id: principal.actorId },
        authorityBasis:
          run.authorizationConnectionId && run.automationScheduleId
            ? "original_live_grant"
            : principal.actorType === "user" && principal.actorId === run.userId
              ? "authenticated_owner"
              : "legacy_unbound_context",
        humanApproval: input.humanApproval
          ? {
              actorId: input.humanApproval.principal.actorId,
              reviewId: input.humanApproval.reviewId,
            }
          : null,
        sourceMessageIds: claim?.sourceMessageIds ?? [],
        explanation,
        auditEventIds: newAudits.map((audit) => audit.id),
        recordRefs,
        outcome: "committed",
        actionFamilies,
        status: newAudits.length ? "applied" : "no_changes",
        significance: actionFamilies.includes("budget_plan") ? "budget_decision" : "routine",
      });
      return { financeEffectReceipt: receipt };
    },
    tx,
  );
  return financeConversationEffectReceiptSchema.parse(response.financeEffectReceipt);
}
