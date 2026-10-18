import { isDeepStrictEqual } from "node:util";
import {
  type Database,
  financeConversationBatches,
  financeConversationBatchMessages,
  financeConversationEvidence,
  financeConversationMessages,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { AppError } from "../errors.js";
import type { Principal } from "../types.js";
import { requireWorkspaceExecution } from "../workspace-execution.js";
import { requireHostRunAuthority } from "./host-run-authority.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type FinanceConversationEvidenceInput = {
  runId: string;
  caseId: string | null;
  actionKey: string;
  sourceOperationId: string | null;
  sourceMessageIds: string[];
  explanation: string;
};

/**
 * Called only by a mutation owner inside its transaction after its existing exact
 * financial authority/revision checks. This helper grants no financial authority.
 * Replays return committed evidence without invoking applyEffect again.
 */
export async function commitFinanceConversationEvidence(
  tx: Transaction,
  principal: Principal,
  input: FinanceConversationEvidenceInput,
  applyEffect: () => Promise<Array<{ kind: string; id: string }>>,
  now: Date,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`finance-maintenance:${principal.userId}`}, 0))`,
  );
  if (
    !input.actionKey.trim() ||
    input.actionKey.length > 200 ||
    !input.explanation.trim() ||
    input.explanation.length > 4000 ||
    !input.sourceMessageIds.length ||
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
  await requireHostRunAuthority(tx, run, principal, now);
  await requireWorkspaceExecution(tx, principal, "finances", now);
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
  const sources = await tx
    .select({ message: financeConversationMessages })
    .from(financeConversationBatchMessages)
    .innerJoin(
      financeConversationMessages,
      and(
        eq(financeConversationMessages.userId, financeConversationBatchMessages.userId),
        eq(financeConversationMessages.id, financeConversationBatchMessages.messageId),
      ),
    )
    .where(
      and(
        eq(financeConversationBatchMessages.userId, principal.userId),
        eq(financeConversationBatchMessages.runId, input.runId),
        isNotNull(financeConversationBatchMessages.deliveredAt),
        inArray(financeConversationBatchMessages.messageId, input.sourceMessageIds),
      ),
    );
  if (
    sources.length !== input.sourceMessageIds.length ||
    sources.some(({ message }) => message.sequence > batch.cutoffSequence) ||
    (input.caseId && !sources.some(({ message }) => message.caseId === input.caseId))
  )
    throw new AppError(
      "conflict",
      "Action evidence must cite its owner-scoped fixed batch and canonical case.",
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
  // Callback failure or evidence insert failure rolls back the caller's transaction.
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
