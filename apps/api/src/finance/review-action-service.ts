import { randomUUID } from "node:crypto";
import {
  auditEvents,
  financeAccounts,
  financeAnswerContinuations,
  financeMaintenanceCandidates,
  financeReviewActionRequests,
  financeReviewAnswers,
  financeReviewCases,
  financeTransactions,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import {
  decideFinanceReviewActionTransition,
  type FinanceDomainOutcome,
  type FinanceHumanWorkRef,
  type FinanceOutcomeReasonCode,
  type FinanceSmsAnswerCommand,
  financeDomainOutcomeSchema,
  financeReviewActionStateSchema,
  finishFinanceReviewAction,
  issueFinanceReviewAction,
} from "@personal-os/domain";
import { and, eq, inArray } from "drizzle-orm";
import { auditValues } from "../audit.js";
import {
  executeFinanceAdmittedMutation,
  type FinanceTransaction,
  loadFinanceAuthorization,
} from "./context.js";
import {
  type ContextualOptions,
  type ContextualPrincipal,
  contextualRetry,
} from "./contextual-question-store.js";
import { financeMaintenanceLineage } from "./maintenance-rebuild.js";
import { financeReviewPrompt, minimalSmsQuestionPrompt } from "./review-prompt.js";
import type { AdmitSmsAnswer } from "./sms-answer-port.js";
import type { FinanceSmsQuestionResolution } from "./work-resolver.js";

const maxRevision = 9223372036854775807n;
type Review = typeof financeReviewCases.$inferSelect;

/** Projection and rediscovery share the case identity; incidental evidence does not reissue an ask. */
export async function issueMaintenanceReviewQuestion(
  tx: FinanceTransaction,
  userId: string,
  caseId: string,
) {
  const [review] = await tx
    .select()
    .from(financeReviewCases)
    .where(and(eq(financeReviewCases.userId, userId), eq(financeReviewCases.id, caseId)))
    .for("update", { noWait: true });
  if (review?.status !== "open" || !financeMaintenanceLineage(review.evidence)) return;
  if (review.resolution?.type === "clarify" || typeof review.evidence.clarification === "string")
    return;
  if (!(await currentLineage(tx, userId, review))) return;
  const current = financeReviewActionStateSchema.parse(review.humanAction);
  if (review.contextualRevision === maxRevision) throw contextualRetry();
  const desired = {
    action: {
      version: 1,
      kind: "question",
      answerMode: "free_text",
      purpose: "maintenance_clarification",
    },
    basis: {
      subject: { kind: "transaction", id: review.transactionId },
      source: { kind: "finance_review_case", id: review.id },
      reason: review.reasonCode,
      consequence: { kind: "resume_finance_maintenance", target: "same_review_case" },
    },
    work: {
      domain: "finances",
      kind: "question",
      id: review.id,
      revision: (review.contextualRevision + 1n).toString(),
    },
  };
  const decision = decideFinanceReviewActionTransition({
    current,
    desired,
    intent: "observe",
  });
  if (decision.decision !== "needs_issue") return;
  const issued = issueFinanceReviewAction({
    decision,
    authorityOperationId: randomUUID(),
    requestId: randomUUID(),
    retirementOperationId: current.state === "open" ? randomUUID() : null,
    actionRevision: (review.actionRevision + 1n).toString(),
  });
  if (issued.decision !== "issue") throw contextualRetry();
  if (issued.previous.state === "withdrawn" && current.state === "open") {
    await tx
      .update(financeReviewActionRequests)
      .set({ state: "withdrawn", terminalOperationId: issued.previous.terminal.operationId })
      .where(
        and(
          eq(financeReviewActionRequests.userId, userId),
          eq(financeReviewActionRequests.id, current.request.requestId),
          eq(financeReviewActionRequests.state, "open"),
        ),
      );
  }
  await tx.insert(financeReviewActionRequests).values({
    id: issued.request.requestId,
    userId,
    reviewCaseId: review.id,
    authorityOperationId: issued.request.authorityOperationId,
    actionRevision: BigInt(issued.request.work.actionRevision),
    request: issued.request,
    prompt: financeReviewPrompt(review.reasonCode, review.evidence),
  });
  const [changed] = await tx
    .update(financeReviewCases)
    .set({ humanAction: { state: "open", request: issued.request } })
    .where(
      and(
        eq(financeReviewCases.userId, userId),
        eq(financeReviewCases.id, review.id),
        eq(financeReviewCases.contextualRevision, review.contextualRevision),
      ),
    )
    .returning({ id: financeReviewCases.id });
  if (!changed) throw contextualRetry();
}

async function lockReview(tx: FinanceTransaction, userId: string, id: string, write: boolean) {
  const [preview] = await tx
    .select()
    .from(financeReviewCases)
    .where(and(eq(financeReviewCases.userId, userId), eq(financeReviewCases.id, id)));
  if (!preview || preview.humanAction.state === "absent") return null;
  const [transactionPreview] = await tx
    .select()
    .from(financeTransactions)
    .where(
      and(
        eq(financeTransactions.userId, userId),
        eq(financeTransactions.id, preview.transactionId),
      ),
    );
  if (!transactionPreview) throw contextualRetry();
  const [account] = await tx
    .select()
    .from(financeAccounts)
    .where(
      and(eq(financeAccounts.userId, userId), eq(financeAccounts.id, transactionPreview.accountId)),
    )
    .for("share", { noWait: true });
  const [transaction] = await tx
    .select()
    .from(financeTransactions)
    .where(
      and(
        eq(financeTransactions.userId, userId),
        eq(financeTransactions.id, preview.transactionId),
      ),
    )
    .for("share", { noWait: true });
  const [review] = await tx
    .select()
    .from(financeReviewCases)
    .where(and(eq(financeReviewCases.userId, userId), eq(financeReviewCases.id, id)))
    .for(write ? "update" : "share", { noWait: true });
  if (
    !account ||
    !transaction ||
    !review ||
    transaction.accountId !== account.id ||
    review.transactionId !== transaction.id
  )
    throw contextualRetry();
  return { account, transaction, review };
}
async function currentLineage(tx: FinanceTransaction, userId: string, review: Review) {
  const lineage = financeMaintenanceLineage(review.evidence);
  if (!lineage) return false;
  const [run] = await tx
    .select()
    .from(workspaceMaintenanceRuns)
    .where(
      and(
        eq(workspaceMaintenanceRuns.userId, userId),
        eq(workspaceMaintenanceRuns.id, lineage.runId),
        eq(workspaceMaintenanceRuns.domain, "finances"),
        inArray(workspaceMaintenanceRuns.status, [
          "queued",
          "running",
          "awaiting_agent_challenge",
          "awaiting_approval",
          "blocked",
          "failed_recoverable",
          "completed_with_questions",
        ]),
      ),
    )
    .for("share", { noWait: true });
  if (!run) return false;
  const [candidate] = await tx
    .select()
    .from(financeMaintenanceCandidates)
    .where(
      and(
        eq(financeMaintenanceCandidates.userId, userId),
        eq(financeMaintenanceCandidates.id, lineage.candidateId),
        eq(financeMaintenanceCandidates.runId, run.id),
        eq(financeMaintenanceCandidates.revision, lineage.candidateRevision),
        eq(financeMaintenanceCandidates.state, "challenged"),
      ),
    )
    .for("share", { noWait: true });
  return !!candidate;
}
async function resolution(
  tx: FinanceTransaction,
  userId: string,
  work: FinanceHumanWorkRef,
  locked: NonNullable<Awaited<ReturnType<typeof lockReview>>>,
): Promise<FinanceSmsQuestionResolution> {
  const { review, account, transaction } = locked;
  const state = financeReviewActionStateSchema.parse(review.humanAction);
  // Answered requests remain terminal even after unrelated evidence changes.
  if (review.status === "resolved") return { state: "resolved" };
  if (state.state === "consumed" && state.request.work.actionRevision === work.actionRevision)
    return { state: "resolved" };
  if (
    state.state !== "open" ||
    review.status !== "open" ||
    work.revision !== state.request.work.revision ||
    work.actionRevision !== review.actionRevision.toString() ||
    transaction.pending ||
    !transaction.needsReview ||
    !["manual", "connected"].includes(account.status) ||
    !(await currentLineage(tx, userId, review))
  )
    return { state: "stale" };
  const [issuance] = await tx
    .select({ prompt: financeReviewActionRequests.prompt })
    .from(financeReviewActionRequests)
    .where(
      and(
        eq(financeReviewActionRequests.userId, userId),
        eq(financeReviewActionRequests.id, state.request.requestId),
        eq(financeReviewActionRequests.state, "open"),
      ),
    )
    .for("share", { noWait: true });
  if (!issuance) return { state: "stale" };
  return {
    state: "current",
    prompt: issuance.prompt,
    value: {
      work,
      active: true,
      expiresAt: null,
      disclosure: "minimal",
      context: null,
      questionPrompt: minimalSmsQuestionPrompt(issuance.prompt),
      occurredAt: null,
      destination: `/finances/review?case=${encodeURIComponent(review.id)}`,
    },
  };
}
export async function resolveMaintenanceReviewQuestion(
  userId: string,
  work: FinanceHumanWorkRef,
  tx: FinanceTransaction,
): Promise<FinanceSmsQuestionResolution> {
  if (work.kind !== "question") return { state: "unavailable" };
  const locked = await lockReview(tx, userId, work.id, false);
  return locked ? resolution(tx, userId, work, locked) : { state: "unavailable" };
}
export async function answerMaintenanceReviewQuestion(
  options: ContextualOptions,
  command: FinanceSmsAnswerCommand,
  context: ContextualPrincipal,
  tx: FinanceTransaction,
  admit: AdmitSmsAnswer,
): Promise<FinanceDomainOutcome> {
  const authority = await loadFinanceAuthorization({ db: tx, ...context });
  function outcome(
    state: "accepted" | "blocked" | "unavailable",
    resultRevision: string | null = null,
    unavailableReason: FinanceOutcomeReasonCode = "producer_not_registered",
  ) {
    return financeDomainOutcomeSchema.parse({
      operationId: command.operationId,
      state,
      resultRevision,
      work: [],
      reasonCode:
        state === "blocked" ? "stale_revision" : state === "unavailable" ? unavailableReason : null,
    });
  }
  return executeFinanceAdmittedMutation<
    {
      locked: Awaited<ReturnType<typeof lockReview>>;
      consume: (accepted: FinanceDomainOutcome & { state: "accepted" }) => Promise<void>;
    },
    FinanceDomainOutcome
  >(
    tx,
    authority,
    {
      idempotencyKey: command.operationId,
      operation: "answer_finance_review_question_v1",
      sourceKind: "sms",
      payload: command,
    },
    async (preparedTx) => {
      const admitted = await admit(preparedTx, { ...command, userId: context.principal.userId });
      if (admitted.state !== "verified")
        return { state: "unavailable", result: outcome("unavailable", null, admitted.reasonCode) };
      const locked = await lockReview(preparedTx, context.principal.userId, command.work.id, true);
      if (!locked) return { state: "unavailable", result: outcome("unavailable") };
      const resolved = await resolution(preparedTx, context.principal.userId, command.work, locked);
      if (resolved.state !== "current")
        return { state: "admitted", prepared: { locked: null, consume: admitted.consume } };
      if (locked.review.contextualRevision === maxRevision) throw contextualRetry();
      return { state: "admitted", prepared: { locked, consume: admitted.consume } };
    },
    async (writeTx, prepared) => {
      if (!prepared.locked) return outcome("blocked");
      const { review } = prepared.locked;
      const action = financeReviewActionStateSchema.parse(review.humanAction);
      if (action.state !== "open") throw contextualRetry();
      const terminal = finishFinanceReviewAction({
        current: action,
        expectedRequestId: action.request.requestId,
        operationId: command.operationId,
        transition: "consume",
      });
      if (terminal.decision !== "consume") throw contextualRetry();
      await writeTx
        .update(financeReviewActionRequests)
        .set({ state: "consumed", terminalOperationId: command.operationId })
        .where(
          and(
            eq(financeReviewActionRequests.userId, context.principal.userId),
            eq(financeReviewActionRequests.id, action.request.requestId),
            eq(financeReviewActionRequests.state, "open"),
          ),
        );
      const [changed] = await writeTx
        .update(financeReviewCases)
        .set({
          humanAction: terminal.state,
          resolution: { type: "clarify", answer: command.text, clarification: command.text },
          resolutionProvenance: {
            actorType: "user",
            actorId: context.principal.userId,
            requestId: context.requestId,
            sourceKind: "sms",
            inboundMessageId: command.inboundMessageId,
            replyBindingId: command.replyBindingId,
          },
          updatedAt: options.now?.() ?? new Date(),
        })
        .where(
          and(
            eq(financeReviewCases.userId, context.principal.userId),
            eq(financeReviewCases.id, review.id),
            eq(financeReviewCases.contextualRevision, review.contextualRevision),
          ),
        )
        .returning();
      if (!changed) throw contextualRetry();
      await writeTx.insert(financeReviewAnswers).values({
        userId: context.principal.userId,
        reviewCaseId: review.id,
        requestId: action.request.requestId,
        operationId: command.operationId,
        answeredWorkRevision: review.contextualRevision,
        answeredActionRevision: review.actionRevision,
        resultingWorkRevision: changed.contextualRevision,
        text: command.text,
        sourceKind: "sms",
        inboundMessageId: command.inboundMessageId,
        replyBindingId: command.replyBindingId,
        actorType: "user",
        actorId: context.principal.userId,
      });
      const lineage = financeMaintenanceLineage(review.evidence);
      const [originRun] = lineage
        ? await writeTx
            .select()
            .from(workspaceMaintenanceRuns)
            .where(
              and(
                eq(workspaceMaintenanceRuns.userId, context.principal.userId),
                eq(workspaceMaintenanceRuns.id, lineage.runId),
              ),
            )
            .limit(1)
        : [];
      await writeTx.insert(financeAnswerContinuations).values({
        userId: context.principal.userId,
        operationId: command.operationId,
        reviewCaseId: review.id,
        transactionId: review.transactionId,
        resultingWorkRevision: changed.contextualRevision,
        automationScheduleId: originRun?.automationScheduleId ?? null,
      });
      await writeTx.insert(auditEvents).values(
        auditValues({
          ...context,
          action: "finance.review_answer.accepted",
          entityId: review.id,
          entityType: "finance_review_case",
          before: {
            revision: review.contextualRevision.toString(),
            actionRevision: review.actionRevision.toString(),
          },
          after: {
            operationId: command.operationId,
            revision: changed.contextualRevision.toString(),
            state: "accepted",
          },
        }),
      );
      const accepted = outcome("accepted", changed.contextualRevision.toString());
      if (accepted.state !== "accepted") throw contextualRetry();
      await prepared.consume({ ...accepted, state: "accepted" });
      return accepted;
    },
  );
}

/** The app's existing reviewed decision path consumes the same authority as SMS. */
export async function finishMaintenanceReviewFromApp(
  tx: FinanceTransaction,
  review: Review,
  transition: "consume" | "withdraw",
) {
  const current = financeReviewActionStateSchema.parse(review.humanAction);
  if (current.state !== "open") return null;
  const locked = await lockReview(tx, review.userId, review.id, true);
  if (
    !locked ||
    locked.review.contextualRevision !== review.contextualRevision ||
    locked.review.humanAction.state !== "open" ||
    locked.review.humanAction.request.requestId !== current.request.requestId
  )
    throw contextualRetry();
  if (transition === "consume" && !(await currentLineage(tx, review.userId, locked.review)))
    throw contextualRetry();
  const operationId = randomUUID();
  const result = finishFinanceReviewAction({
    current,
    expectedRequestId: current.request.requestId,
    operationId,
    transition,
  });
  if (result.decision !== transition) throw contextualRetry();
  const [changed] = await tx
    .update(financeReviewActionRequests)
    .set({
      state: transition === "consume" ? "consumed" : "withdrawn",
      terminalOperationId: operationId,
    })
    .where(
      and(
        eq(financeReviewActionRequests.userId, review.userId),
        eq(financeReviewActionRequests.id, current.request.requestId),
        eq(financeReviewActionRequests.state, "open"),
      ),
    )
    .returning();
  if (!changed) throw contextualRetry();
  return result.state;
}
export async function recordMaintenanceReviewAppAnswer(
  tx: FinanceTransaction,
  review: Review,
  resultingRevision: bigint,
  action: NonNullable<Awaited<ReturnType<typeof finishMaintenanceReviewFromApp>>>,
  text: string,
  context: import("./context.js").FinanceMutationContext,
  recordedAt: Date,
) {
  if (action.state !== "consumed") return;
  await tx.insert(financeReviewAnswers).values({
    userId: review.userId,
    reviewCaseId: review.id,
    requestId: action.request.requestId,
    operationId: action.terminal.operationId,
    answeredWorkRevision: review.contextualRevision,
    answeredActionRevision: review.actionRevision,
    resultingWorkRevision: resultingRevision,
    text,
    sourceKind: context.actorType === "user" ? "app" : "agent",
    actorType: context.actorType,
    actorId: context.actorId,
    recordedAt,
  });
  const lineage = financeMaintenanceLineage(review.evidence);
  const [run] = lineage
    ? await tx
        .select()
        .from(workspaceMaintenanceRuns)
        .where(
          and(
            eq(workspaceMaintenanceRuns.userId, review.userId),
            eq(workspaceMaintenanceRuns.id, lineage.runId),
          ),
        )
        .limit(1)
    : [];
  await tx.insert(financeAnswerContinuations).values({
    userId: review.userId,
    operationId: action.terminal.operationId,
    reviewCaseId: review.id,
    transactionId: review.transactionId,
    resultingWorkRevision: resultingRevision,
    automationScheduleId: run?.automationScheduleId ?? null,
  });
  await tx.insert(auditEvents).values(
    auditValues({
      principal: {
        actorId: context.actorId,
        actorType: context.actorType,
        userId: context.userId,
      },
      requestId: context.requestId,
      action: "finance.review_answer.accepted",
      entityId: review.id,
      entityType: "finance_review_case",
      before: { revision: review.contextualRevision.toString() },
      after: { revision: resultingRevision.toString(), operationId: action.terminal.operationId },
    }),
  );
}
