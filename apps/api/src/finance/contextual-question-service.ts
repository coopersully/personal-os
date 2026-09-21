import { auditEvents, financeContextualQuestions, financeReviewCases } from "@personal-os/database";
import {
  createFinanceContextualQuestionInputSchema,
  type FinanceContextualQuestionResult,
  financeContextualQuestionResultSchema,
  idSchema,
} from "@personal-os/domain";
import { and, eq } from "drizzle-orm";
import { auditValues } from "../audit.js";
import { AppError } from "../errors.js";
import { answerContextualWork } from "./answer-service.js";
import {
  executeFinanceAdmittedMutation,
  type FinanceTransaction,
  loadFinanceAuthorization,
} from "./context.js";
import {
  admitContextualOwner,
  authorizeContextual,
  type ContextualOptions,
  type ContextualPrincipal,
  contextualRetry,
  contextualSubtype,
  contextualTransaction,
  contextualValue,
  eligibleContextualTransaction,
  type LockedContextualQuestion,
  lockContextualQuestion,
  lockContextualTransaction,
} from "./contextual-question-store.js";
import { resolveContextualWork } from "./work-resolver.js";

const unavailable = (): FinanceContextualQuestionResult => ({
  state: "unavailable",
  reasonCode: "producer_not_registered",
  retryable: false,
});
type Prepared =
  | { kind: "existing"; locked: LockedContextualQuestion }
  | { kind: "create"; parent: NonNullable<Awaited<ReturnType<typeof lockContextualTransaction>>> };

export function createFinanceContextualQuestionService(options: ContextualOptions) {
  return {
    async createQuestion(
      transactionId: string,
      raw: unknown,
      context: ContextualPrincipal,
      executor?: FinanceTransaction,
    ): Promise<FinanceContextualQuestionResult> {
      authorizeContextual(context, "finances:write");
      if (context.principal.actorType !== "user")
        throw new AppError(
          "forbidden",
          "Creating contextual questions requires an interactive user session.",
        );
      idSchema.parse(transactionId);
      const input = createFinanceContextualQuestionInputSchema.parse(raw);
      return contextualTransaction(options.db, executor, async (tx) => {
        const authority = await loadFinanceAuthorization({ db: tx, ...context });
        return executeFinanceAdmittedMutation<Prepared, FinanceContextualQuestionResult>(
          tx,
          authority,
          {
            idempotencyKey: input.operationId,
            operation: "create_contextual_question_v1",
            payload: { ...input, transactionId },
            sourceKind: "app",
          },
          async (preparedTx) => {
            const parent = await lockContextualTransaction(
              preparedTx,
              context.principal.userId,
              transactionId,
              true,
            );
            if (!parent) return { state: "unavailable", result: unavailable() };
            const [existing] = await preparedTx
              .select({ id: financeContextualQuestions.id })
              .from(financeContextualQuestions)
              .where(
                and(
                  eq(financeContextualQuestions.userId, context.principal.userId),
                  eq(financeContextualQuestions.transactionId, transactionId),
                  eq(financeContextualQuestions.subtype, contextualSubtype),
                ),
              );
            if (existing) {
              const locked = await lockContextualQuestion(
                preparedTx,
                context.principal.userId,
                existing.id,
                false,
                parent,
              );
              if (!locked) throw contextualRetry();
              return { state: "admitted", prepared: { kind: "existing", locked } };
            }
            if (!eligibleContextualTransaction(parent))
              return { state: "unavailable", result: unavailable() };
            return { state: "admitted", prepared: { kind: "create", parent } };
          },
          async (writeTx, prepared) => {
            if (prepared.kind === "existing")
              return { state: "available", question: contextualValue(prepared.locked) };
            const { account, transaction } = prepared.parent;
            const recordedAt = options.now?.() ?? new Date();
            const [review] = await writeTx
              .insert(financeReviewCases)
              .values({
                userId: context.principal.userId,
                transactionId: transaction.id,
                stableKey: `contextual-purpose:${transaction.id}`,
                reason: "unknown_merchant",
                reasonCode: "missing_provenance",
                rationale: "Context requested by the person.",
                createdAt: recordedAt,
                updatedAt: recordedAt,
              })
              .returning();
            if (!review)
              throw new AppError("internal_error", "The contextual review was not created.");
            const [question] = await writeTx
              .insert(financeContextualQuestions)
              .values({
                userId: context.principal.userId,
                subtype: contextualSubtype,
                reviewCaseId: review.id,
                transactionId: transaction.id,
                accountId: account.id,
                accountRevision: account.contextualRevision,
                transactionRevision: transaction.contextualRevision,
                reviewRevision: review.contextualRevision,
                prompt: "What was this transaction for?",
                merchant: transaction.merchant.slice(0, 1000),
                transactionDate: transaction.transactionDate,
                amount: transaction.amount,
                currencyCode: transaction.currencyCode,
                createdAt: recordedAt,
                updatedAt: recordedAt,
              })
              .returning();
            if (!question)
              throw new AppError("internal_error", "The contextual question was not created.");
            await writeTx.insert(auditEvents).values(
              auditValues({
                ...context,
                action: "finance.contextual_question.created",
                entityType: "finance_contextual_question",
                entityId: question.id,
                before: null,
                after: {
                  reviewCaseId: review.id,
                  transactionId: transaction.id,
                  revision: "1",
                  actionRevision: "1",
                },
              }),
            );
            return financeContextualQuestionResultSchema.parse({
              state: "available",
              question: contextualValue({ account, transaction, review, question }),
            });
          },
        );
      });
    },
    async getQuestion(
      id: string,
      context: ContextualPrincipal,
      executor?: FinanceTransaction,
    ): Promise<FinanceContextualQuestionResult> {
      authorizeContextual(context, "finances:read");
      idSchema.parse(id);
      return contextualTransaction(options.db, executor, async (tx) => {
        await admitContextualOwner(tx, context.principal.userId);
        const locked = await lockContextualQuestion(tx, context.principal.userId, id, false);
        return locked ? { state: "available", question: contextualValue(locked) } : unavailable();
      });
    },
    answerWork: (raw: unknown, context: ContextualPrincipal, executor?: FinanceTransaction) =>
      answerContextualWork(options, raw, context, executor),
    resolveWork: resolveContextualWork,
  };
}
