import {
  auditEvents,
  financeContextualAnswers,
  financeContextualQuestions,
} from "@personal-os/database";
import {
  type FinanceAnswer,
  type FinanceDomainOutcome,
  type FinanceSmsAnswerCommand,
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

import type { AdmitSmsAnswer } from "./sms-answer-port.js";

type Consume = (accepted: FinanceDomainOutcome & { state: "accepted" }) => Promise<void>;
type Prepared =
  | { kind: "stale" }
  | { kind: "current"; locked: LockedContextualQuestion; consume: Consume | undefined };
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
  return answerCore(options, input, context, executor);
}

/** Internal entry; only the server-composed SMS port supplies admission. */
export async function answerSmsContextualWork(
  options: ContextualOptions,
  command: FinanceSmsAnswerCommand,
  context: ContextualPrincipal,
  executor: FinanceTransaction,
  admit: AdmitSmsAnswer,
): Promise<FinanceDomainOutcome> {
  return answerCore(
    options,
    {
      operationId: command.operationId,
      work: command.work,
      text: command.text,
      source: { kind: "sms", messageId: command.inboundMessageId },
    },
    context,
    executor,
    { command, admit },
  );
}

async function answerCore(
  options: ContextualOptions,
  input: FinanceAnswer,
  context: ContextualPrincipal,
  executor?: FinanceTransaction,
  sms?: { command: FinanceSmsAnswerCommand; admit: AdmitSmsAnswer },
): Promise<FinanceDomainOutcome> {
  const sourceKind = input.source.kind;
  if (input.work.kind !== "question") return outcome(input.operationId, "unavailable");
  return contextualTransaction(options.db, executor, async (tx) => {
    const authority = await loadFinanceAuthorization({ db: tx, ...context });
    return executeFinanceAdmittedMutation<Prepared, FinanceDomainOutcome>(
      tx,
      authority,
      {
        idempotencyKey: input.operationId,
        operation: "answer_contextual_question_v1",
        payload: sms?.command ?? input,
        sourceKind,
      },
      async (preparedTx) => {
        let consume: Consume | undefined;
        if (sms) {
          const admitted = await sms.admit(preparedTx, {
            ...sms.command,
            userId: context.principal.userId,
          });
          if (admitted.state !== "verified")
            return { state: "unavailable", result: outcome(input.operationId, "unavailable") };
          consume = admitted.consume;
        }
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
        return { state: "admitted", prepared: { kind: "current", locked, consume } };
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
            sourceMessageId: sms?.command.inboundMessageId ?? null,
            sourceReplyBindingId: sms?.command.replyBindingId ?? null,
            actorType: context.principal.actorType as "user" | "agent",
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
        const accepted = {
          ...outcome(input.operationId, "accepted", revision.toString()),
          state: "accepted" as const,
        };
        await prepared.consume?.(accepted);
        return accepted;
      },
    );
  });
}
