import {
  accessTokens,
  auditEvents,
  type Database,
  financeContextualQuestions,
  financeConversationBatches,
  financeConversationBatchMessages,
  financeConversationCapabilities,
  financeConversationMessages,
  type financeMaintenanceCandidateItems,
  financeReviewCases,
  financeTransactions,
  type workspaceMaintenanceRuns,
} from "@personal-os/database";
import {
  FINANCE_CONVERSATION_PROTOCOL_VERSION,
  type FinanceConversationCausalClaim,
} from "@personal-os/domain";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { AppError } from "../errors.js";
import type { Principal } from "../types.js";
import { requireWorkspaceExecution } from "../workspace-execution.js";
import { requireHostRunAuthority } from "./host-run-authority.js";
export type FinanceEffectTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export async function lockFinanceEffectOwner(tx: FinanceEffectTransaction, userId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`finance-maintenance:${userId}`}, 0))`,
  );
}
/** Reload persisted authority; reconstructed internal scope sets are never grants. */
export async function loadFinanceEffectPrincipal(
  tx: FinanceEffectTransaction,
  run: typeof workspaceMaintenanceRuns.$inferSelect,
  supplied: Principal,
  at: Date,
  requireExecution: boolean,
): Promise<Principal> {
  if (!run.authorizationConnectionId && !run.automationScheduleId) return supplied;
  const [token] = await tx
    .select()
    .from(accessTokens)
    .where(and(eq(accessTokens.userId, run.userId), eq(accessTokens.id, supplied.actorId)))
    .for("share");
  if (token?.revokedAt)
    throw new AppError("forbidden", "The original Finance submitting credential was revoked.", {
      reason: "submitting_credential_revoked",
      recovery: "reconnect_and_recover",
      runId: run.id,
    });
  if (token?.expiresAt && token.expiresAt <= at)
    throw new AppError(
      "conflict",
      "The original Finance submitting credential expired. Reconnect and explicitly recover the saved run.",
      { reason: "submitting_credential_expired", recovery: "reconnect_and_recover", runId: run.id },
    );
  if (!token || token.authorizationConnectionId !== run.authorizationConnectionId)
    throw new AppError("forbidden", "The original Finance agent grant is no longer active.");
  const principal: Principal = {
    userId: run.userId,
    actorId: token.id,
    actorType: "agent",
    authorizationConnectionId: token.authorizationConnectionId ?? undefined,
    scopes: new Set(token.scopes),
  };
  await requireHostRunAuthority(tx, run, principal, at);
  if (requireExecution) await requireWorkspaceExecution(tx, principal, "finances", at);
  return principal;
}
export async function requireFinanceEffectMessageProof(
  tx: FinanceEffectTransaction,
  run: typeof workspaceMaintenanceRuns.$inferSelect,
  principal: Principal,
  at: Date,
) {
  await requireHostRunAuthority(tx, run, principal, at);
  if (!run.authorizationConnectionId || !run.automationScheduleId)
    throw new AppError("forbidden", "Use the original registered Finance message host.");
  const [proof] = await tx
    .select({ id: financeConversationCapabilities.id })
    .from(financeConversationCapabilities)
    .where(
      and(
        eq(financeConversationCapabilities.userId, run.userId),
        eq(financeConversationCapabilities.automationScheduleId, run.automationScheduleId),
        eq(
          financeConversationCapabilities.authorizationConnectionId,
          run.authorizationConnectionId,
        ),
        eq(financeConversationCapabilities.protocolVersion, FINANCE_CONVERSATION_PROTOCOL_VERSION),
        isNotNull(financeConversationCapabilities.verifiedAt),
      ),
    )
    .limit(1);
  if (!proof)
    throw new AppError("forbidden", "Verify the original host's current Finance message protocol.");
}
export function financeCandidateRecordIds(
  items: ReadonlyArray<typeof financeMaintenanceCandidateItems.$inferSelect>,
): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    for (const change of item.safeChanges)
      if (typeof change.entityId === "string") ids.add(change.entityId);
    for (const ref of item.sourceRefs)
      if (typeof ref.remoteId === "string" && String(ref.sourceType).startsWith("finance_"))
        ids.add(ref.remoteId);
  }
  return ids;
}
/** Revalidate at submission AND at effect commit, including delivery and fixed cutoff. */
export async function validateFinanceConversationClaim(
  tx: FinanceEffectTransaction,
  run: typeof workspaceMaintenanceRuns.$inferSelect,
  principal: Principal,
  items: ReadonlyArray<typeof financeMaintenanceCandidateItems.$inferSelect>,
  claim: FinanceConversationCausalClaim,
  at: Date,
) {
  await requireFinanceEffectMessageProof(tx, run, principal, at);
  const [batch] = await tx
    .select()
    .from(financeConversationBatches)
    .where(
      and(
        eq(financeConversationBatches.userId, run.userId),
        eq(financeConversationBatches.runId, run.id),
      ),
    );
  if (
    !batch ||
    batch.authorizationConnectionId !== run.authorizationConnectionId ||
    batch.automationScheduleId !== run.automationScheduleId
  )
    throw new AppError("conflict", "Use the original fixed Finance message batch.");
  const messages = await tx
    .select()
    .from(financeConversationMessages)
    .where(
      and(
        eq(financeConversationMessages.userId, run.userId),
        inArray(financeConversationMessages.id, claim.sourceMessageIds),
      ),
    );
  if (
    messages.length !== claim.sourceMessageIds.length ||
    messages.some((message) => message.sequence > batch.cutoffSequence)
  )
    throw new AppError(
      "conflict",
      "Causal sources must belong to the owner and precede the fixed run cutoff.",
    );
  const delivered = await tx
    .select({ id: financeConversationBatchMessages.messageId })
    .from(financeConversationBatchMessages)
    .where(
      and(
        eq(financeConversationBatchMessages.userId, run.userId),
        eq(financeConversationBatchMessages.runId, run.id),
        inArray(financeConversationBatchMessages.messageId, claim.sourceMessageIds),
        isNotNull(financeConversationBatchMessages.deliveredAt),
      ),
    );
  const deliveredIds = new Set(delivered.map((row) => row.id));
  const answers = messages.filter(
    (message) => deliveredIds.has(message.id) && message.authorKind === "user",
  );
  if (!answers.length)
    throw new AppError(
      "conflict",
      "A causal claim needs an actually delivered current-batch answer.",
    );
  const recordIds = financeCandidateRecordIds(items);
  for (const answer of answers) {
    const caseId = answer.caseId ?? answer.recordRefs.find((ref) => ref.kind === "review_case")?.id;
    if (!caseId)
      throw new AppError("conflict", "A causal answer needs its canonical Finance case.");
    const [review] = await tx
      .select()
      .from(financeReviewCases)
      .where(and(eq(financeReviewCases.userId, run.userId), eq(financeReviewCases.id, caseId)))
      .for("share");
    const [transaction] = review
      ? await tx
          .select({ id: financeTransactions.id })
          .from(financeTransactions)
          .where(
            and(
              eq(financeTransactions.userId, run.userId),
              eq(financeTransactions.id, review.transactionId),
            ),
          )
          .for("share")
      : [];
    const questionRef = answer.recordRefs.find((ref) => ref.kind === "contextual_question");
    if (questionRef) {
      const [question] = await tx
        .select({ id: financeContextualQuestions.id })
        .from(financeContextualQuestions)
        .where(
          and(
            eq(financeContextualQuestions.userId, run.userId),
            eq(financeContextualQuestions.id, questionRef.id),
            eq(financeContextualQuestions.reviewCaseId, caseId),
            eq(
              financeContextualQuestions.transactionId,
              review?.transactionId ?? "00000000-0000-0000-0000-000000000000",
            ),
          ),
        )
        .for("share");
      if (!question)
        throw new AppError(
          "conflict",
          "The answer's question does not belong to this exact canonical case and record.",
        );
    }
    if (
      !transaction ||
      !review ||
      !recordIds.has(review.transactionId) ||
      !answer.recordRefs.some(
        (ref) => ref.kind === "transaction" && ref.id === review.transactionId,
      )
    )
      throw new AppError(
        "conflict",
        "Causal answers must match the candidate's actual affected record and case.",
      );
  }
  for (const message of messages) {
    if (deliveredIds.has(message.id)) continue;
    const question = message.recordRefs.find((ref) => ref.kind === "contextual_question");
    const caseId =
      message.caseId ?? message.recordRefs.find((ref) => ref.kind === "review_case")?.id;
    const matching =
      question &&
      caseId &&
      answers.some(
        (answer) =>
          answer.recordRefs.some(
            (ref) => ref.kind === "contextual_question" && ref.id === question.id,
          ) &&
          (answer.caseId ?? answer.recordRefs.find((ref) => ref.kind === "review_case")?.id) ===
            caseId,
      );
    if (
      !matching ||
      message.authorKind !== "agent" ||
      message.idempotencyKey !== `question:${question?.id}:1` ||
      !message.sourceOperationId
    )
      throw new AppError(
        "conflict",
        "A prior source must be the actual canonical question for a delivered answer.",
      );
    const [audit] = await tx
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.userId, run.userId),
          eq(auditEvents.action, "finance.contextual_question.created"),
          eq(auditEvents.entityId, question.id),
          eq(auditEvents.actorType, "agent"),
          sql`${auditEvents.after}->>'operationId' = ${message.sourceOperationId}`,
          sql`${auditEvents.after}->>'prompt' = ${message.text}`,
        ),
      )
      .limit(1);
    if (!audit)
      throw new AppError(
        "conflict",
        "The historical question's canonical actor and text are unproven.",
      );
  }
  return { batch, messages };
}
