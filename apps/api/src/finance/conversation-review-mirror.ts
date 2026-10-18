import {
  accessTokens,
  auditEvents,
  financeConversationMessages,
  financeLedgerChallenges,
  type financeReviewActionRequests,
  type financeReviewCases,
  financeTransactions,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import { and, eq, sql } from "drizzle-orm";
import { auditValues } from "../audit.js";
import { AppError } from "../errors.js";
import type { Principal } from "../types.js";
import { requireWorkspaceExecution } from "../workspace-execution.js";
import type { FinanceTransaction } from "./context.js";
import { loadFinanceEffectPrincipal } from "./conversation-causality.js";
import { mirrorCreatedFinanceQuestion } from "./conversation-question-mirror.js";
import { recordFinanceConversationAcceptedAnswer } from "./conversation-service.js";

/** Called only for the canonical request inserted in this transaction, never rediscovery. */
export async function mirrorNewMaintenanceReviewQuestion(
  tx: FinanceTransaction,
  input: {
    userId: string;
    runId: string;
    candidateId: string;
    candidateItemId: string;
    candidateRevision: string;
    review: typeof financeReviewCases.$inferSelect;
    request: typeof financeReviewActionRequests.$inferSelect;
    requestId: string;
  },
) {
  const [challenge] = await tx
    .select()
    .from(financeLedgerChallenges)
    .where(
      and(
        eq(financeLedgerChallenges.userId, input.userId),
        eq(financeLedgerChallenges.runId, input.runId),
        eq(financeLedgerChallenges.candidateId, input.candidateId),
      ),
    );
  // Legacy synthetic actors are not authenticated agents and must never become Chat authors.
  if (
    !challenge?.submittingAgentId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      challenge.submittingAgentId,
    )
  )
    return null;
  const [token] = await tx
    .select()
    .from(accessTokens)
    .where(
      and(eq(accessTokens.userId, input.userId), eq(accessTokens.id, challenge.submittingAgentId)),
    );
  const [run] = await tx
    .select()
    .from(workspaceMaintenanceRuns)
    .where(
      and(
        eq(workspaceMaintenanceRuns.userId, input.userId),
        eq(workspaceMaintenanceRuns.id, input.runId),
      ),
    );
  if (!token || !run) return null;
  let principal: Principal = {
    userId: input.userId,
    actorId: token.id,
    actorType: "agent",
    scopes: new Set(token.scopes),
    ...(token.authorizationConnectionId
      ? { authorizationConnectionId: token.authorizationConnectionId }
      : {}),
  };
  try {
    principal = await loadFinanceEffectPrincipal(tx, run, principal, new Date(), true);
    await requireWorkspaceExecution(tx, principal, "finances", new Date());
  } catch (error) {
    if (error instanceof AppError && (error.code === "forbidden" || error.code === "conflict"))
      return null;
    throw error;
  }
  const [transaction] = await tx
    .select()
    .from(financeTransactions)
    .where(
      and(
        eq(financeTransactions.userId, input.userId),
        eq(financeTransactions.id, input.review.transactionId),
      ),
    );
  if (!transaction) return null;
  const message = await mirrorCreatedFinanceQuestion(tx, principal, {
    caseId: input.review.id,
    transactionId: transaction.id,
    accountId: transaction.accountId,
    operationId: input.request.authorityOperationId,
    prompt: input.request.prompt,
    createdAt: input.request.createdAt,
    idempotencyKey: `review-question:${input.review.id}:${input.candidateItemId}:${input.candidateRevision}:${input.request.actionRevision}`,
  });
  if (message)
    await tx.insert(auditEvents).values(
      auditValues({
        principal,
        requestId: input.requestId,
        action: "finance.review_question.created",
        entityType: "finance_review_case",
        entityId: input.review.id,
        before: null,
        after: {
          operationId: input.request.authorityOperationId,
          requestId: input.request.id,
          candidateItemId: input.candidateItemId,
          candidateRevision: input.candidateRevision,
          actionRevision: input.request.actionRevision.toString(),
          prompt: input.request.prompt,
        },
      }),
    );
  return message;
}

/** The caller has already accepted the exact owner answer under canonical authority. */
export async function mirrorAcceptedMaintenanceReviewAnswer(
  tx: FinanceTransaction,
  input: {
    userId: string;
    actorType: "user" | "agent";
    actorId: string;
    caseId: string;
    transactionId: string;
    requestId: string;
    operationId: string;
    text: string;
    recordedAt: Date;
  },
) {
  if (input.actorType !== "user" || input.actorId !== input.userId) return null;
  const [question] = await tx
    .select({ id: financeConversationMessages.id })
    .from(financeConversationMessages)
    .innerJoin(
      auditEvents,
      and(
        eq(auditEvents.userId, financeConversationMessages.userId),
        eq(auditEvents.action, "finance.review_question.created"),
        eq(auditEvents.entityId, input.caseId),
        eq(auditEvents.actorType, "agent"),
        sql`${auditEvents.after}->>'requestId' = ${input.requestId}`,
        sql`${auditEvents.after}->>'operationId' = ${financeConversationMessages.sourceOperationId}`,
        sql`${auditEvents.after}->>'prompt' = ${financeConversationMessages.text}`,
      ),
    )
    .where(
      and(
        eq(financeConversationMessages.userId, input.userId),
        eq(financeConversationMessages.authorKind, "agent"),
        sql`${financeConversationMessages.recordRefs} @> ${JSON.stringify([
          { kind: "review_case", id: input.caseId },
          { kind: "transaction", id: input.transactionId },
        ])}::jsonb`,
      ),
    )
    .limit(1);
  return recordFinanceConversationAcceptedAnswer(tx, {
    userId: input.userId,
    operationId: input.operationId,
    caseId: input.caseId,
    transactionId: input.transactionId,
    text: input.text,
    recordedAt: input.recordedAt,
    sourceMessageIds: question ? [question.id] : [],
  });
}
