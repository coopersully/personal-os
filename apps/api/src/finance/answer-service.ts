import {
  auditEvents,
  financeContextualAnswers,
  financeContextualQuestions,
} from "@personal-os/database";
import {
  type FinanceDomainOutcome,
  financeAnswerSchema,
  financeDomainOutcomeSchema,
} from "@personal-os/domain";
import { and, eq } from "drizzle-orm";
import { auditValues } from "../audit.js";
import { AppError } from "../errors.js";
import {
  executeFinanceAdmittedMutation,
  type FinanceTransaction,
  loadFinanceAuthorization,
} from "./context.js";
import {
  authorizeContextual,
  type ContextualOptions,
  type ContextualPrincipal,
  contextualRetry,
  contextualTransaction,
  currentContextualParents,
  type LockedContextualQuestion,
  lockContextualQuestion,
  maxContextualRevision,
} from "./contextual-question-store.js";

type Prepared = { kind: "stale" } | { kind: "current"; locked: LockedContextualQuestion };
function outcome(
  operationId: string,
  state: "unavailable" | "blocked" | "accepted",
  resultRevision: string | null = null,
): FinanceDomainOutcome {
  return financeDomainOutcomeSchema.parse({
    operationId,
    state,
    work: [],
    resultRevision,
    reasonCode:
      state === "unavailable"
        ? "producer_not_registered"
        : state === "blocked"
          ? "stale_revision"
          : null,
  });
}
/** A narrow dispatcher; unsupported public kinds/sources never enter receipt admission. */
export async function answerContextualWork(
  options: ContextualOptions,
  raw: unknown,
  context: ContextualPrincipal,
  executor?: FinanceTransaction,
): Promise<FinanceDomainOutcome> {
  authorizeContextual(context, "finances:write");
  const input = financeAnswerSchema.parse(raw);
  const sourceKind = context.principal.actorType === "user" ? "app" : "agent";
  if (
    input.work.kind !== "question" ||
    input.source.kind !== sourceKind ||
    input.source.messageId !== null
  )
    return outcome(input.operationId, "unavailable");
  return contextualTransaction(options.db, executor, async (tx) => {
    const authority = await loadFinanceAuthorization({ db: tx, ...context });
    return executeFinanceAdmittedMutation<Prepared, FinanceDomainOutcome>(
      tx,
      authority,
      {
        idempotencyKey: input.operationId,
        operation: "answer_contextual_question_v1",
        payload: input,
        sourceKind,
      },
      async (preparedTx) => {
        // Stored subtype is checked only here, after an exact completed receipt can replay.
        const locked = await lockContextualQuestion(
          preparedTx,
          context.principal.userId,
          input.work.id,
          true,
        );
        if (!locked)
          return { state: "unavailable", result: outcome(input.operationId, "unavailable") };
        const { question } = locked;
        if (
          question.state !== "open" ||
          question.workRevision.toString() !== input.work.revision ||
          question.actionRevision.toString() !== input.work.actionRevision ||
          !currentContextualParents(locked)
        )
          return { state: "admitted", prepared: { kind: "stale" } };
        if (question.workRevision === maxContextualRevision)
          throw new AppError("conflict", "Question revision limit reached.");
        return { state: "admitted", prepared: { kind: "current", locked } };
      },
      async (writeTx, prepared) => {
        if (prepared.kind === "stale") return outcome(input.operationId, "blocked");
        const { question } = prepared.locked;
        const recordedAt = options.now?.() ?? new Date();
        const revision = question.workRevision + 1n;
        const [changed] = await writeTx
          .update(financeContextualQuestions)
          .set({ state: "answered", workRevision: revision, updatedAt: recordedAt })
          .where(
            and(
              eq(financeContextualQuestions.userId, context.principal.userId),
              eq(financeContextualQuestions.id, question.id),
              eq(financeContextualQuestions.state, "open"),
              eq(financeContextualQuestions.workRevision, question.workRevision),
              eq(financeContextualQuestions.actionRevision, question.actionRevision),
            ),
          )
          .returning({ id: financeContextualQuestions.id });
        if (!changed) throw contextualRetry();
        const [answer] = await writeTx
          .insert(financeContextualAnswers)
          .values({
            userId: context.principal.userId,
            questionId: question.id,
            operationId: input.operationId,
            answeredWorkRevision: question.workRevision,
            answeredActionRevision: question.actionRevision,
            resultingWorkRevision: revision,
            text: input.text,
            sourceKind,
            sourceMessageId: null,
            actorType: sourceKind === "app" ? "user" : "agent",
            actorId: context.principal.actorId,
            requestId: context.requestId,
            recordedAt,
          })
          .returning({ id: financeContextualAnswers.id });
        if (!answer) throw new AppError("internal_error", "The context answer was not recorded.");
        await writeTx.insert(auditEvents).values(
          auditValues({
            ...context,
            action: "finance.contextual_answer.accepted",
            entityId: question.id,
            entityType: "finance_contextual_question",
            before: {
              revision: question.workRevision.toString(),
              actionRevision: question.actionRevision.toString(),
            },
            after: {
              answerId: answer.id,
              revision: revision.toString(),
              operationId: input.operationId,
              state: "accepted",
            },
          }),
        );
        return outcome(input.operationId, "accepted", revision.toString());
      },
    );
  });
}
