import { isDeepStrictEqual } from "node:util";
import {
  type Database,
  financeConversationBatches,
  financeConversationEvidence,
  type financeMaintenanceCandidateItems,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import { and, eq, or } from "drizzle-orm";
import { AppError } from "../errors.js";
import type { Principal } from "../types.js";
import { requireWorkspaceExecution } from "../workspace-execution.js";
import {
  lockFinanceEffectOwner,
  requireFinanceEffectMessageProof,
  validateFinanceConversationClaim,
} from "./conversation-causality.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type FinanceConversationEvidenceInput = {
  runId: string;
  caseId: string | null;
  actionKey: string;
  sourceOperationId: string | null;
  sourceMessageIds: string[];
  explanation: string;
};

/** The caller owns all financial authority/approval guards and the outer transaction. */
export async function commitFinanceConversationEvidence(
  tx: Transaction,
  principal: Principal,
  input: FinanceConversationEvidenceInput,
  applyEffect: () => Promise<Array<{ kind: string; id: string }>>,
  now: Date,
  options: {
    candidateItems: ReadonlyArray<typeof financeMaintenanceCandidateItems.$inferSelect>;
    humanApproval?: { principal: Principal; reviewId: string };
  },
) {
  await lockFinanceEffectOwner(tx, principal.userId);
  if (
    !input.actionKey.trim() ||
    input.actionKey.length > 200 ||
    !input.explanation.trim() ||
    input.explanation.length > 4000 ||
    input.sourceMessageIds.length > 100 ||
    new Set(input.sourceMessageIds).size !== input.sourceMessageIds.length
  )
    throw new AppError("invalid_request", "Provide bounded causal Finance action evidence.");
  const [run] = await tx
    .select()
    .from(workspaceMaintenanceRuns)
    .where(
      and(
        eq(workspaceMaintenanceRuns.userId, principal.userId),
        eq(workspaceMaintenanceRuns.id, input.runId),
        eq(workspaceMaintenanceRuns.domain, "finances"),
      ),
    )
    .for("update");
  if (
    !run ||
    principal.actorType !== "agent" ||
    !run.authorizationConnectionId ||
    !run.automationScheduleId
  )
    throw new AppError("forbidden", "Use the original Finance maintenance run.");
  await requireFinanceEffectMessageProof(tx, run, principal, now);
  const exactHuman = options.humanApproval?.principal;
  if (
    exactHuman &&
    (exactHuman.actorType !== "user" ||
      exactHuman.userId !== run.userId ||
      exactHuman.actorId !== run.userId)
  )
    throw new AppError("forbidden", "The existing exact owner approval is required.");
  if (!exactHuman) await requireWorkspaceExecution(tx, principal, "finances", now);
  const [batch] = await tx
    .select()
    .from(financeConversationBatches)
    .where(
      and(
        eq(financeConversationBatches.userId, principal.userId),
        eq(financeConversationBatches.runId, input.runId),
      ),
    );
  if (
    !batch ||
    batch.authorizationConnectionId !== run.authorizationConnectionId ||
    batch.automationScheduleId !== run.automationScheduleId
  )
    throw new AppError("conflict", "Use the original captured Finance message batch.");
  if (input.sourceMessageIds.length)
    await validateFinanceConversationClaim(
      tx,
      run,
      principal,
      options.candidateItems,
      { sourceMessageIds: input.sourceMessageIds, explanation: input.explanation },
      now,
    );
  const [existing] = await tx
    .select()
    .from(financeConversationEvidence)
    .where(
      and(
        eq(financeConversationEvidence.userId, principal.userId),
        or(
          eq(financeConversationEvidence.actionKey, input.actionKey),
          input.sourceOperationId
            ? eq(financeConversationEvidence.sourceOperationId, input.sourceOperationId)
            : undefined,
        ),
      ),
    );
  if (existing) {
    if (
      existing.runId !== input.runId ||
      existing.sourceContext.caseId !== input.caseId ||
      existing.actionKey !== input.actionKey ||
      existing.sourceOperationId !== input.sourceOperationId ||
      existing.explanation !== input.explanation ||
      !isDeepStrictEqual(existing.sourceMessageIds, input.sourceMessageIds)
    )
      throw new AppError(
        "conflict",
        "This canonical Finance action already has different evidence.",
      );
    return { evidence: existing, replayed: true };
  }
  const effectRefs = await applyEffect();
  const [evidence] = await tx
    .insert(financeConversationEvidence)
    .values({
      ...input,
      userId: principal.userId,
      caseOwnerId: input.caseId ? principal.userId : null,
      sourceContext: { caseId: input.caseId },
      effectRefs,
      createdAt: now,
    })
    .returning();
  if (!evidence) throw new AppError("internal_error", "Finance effect evidence was not committed.");
  return { evidence, replayed: false };
}
