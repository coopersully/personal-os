import {
  type Database,
  financeAccounts,
  financeContextualAnswers,
  financeContextualQuestions,
  financeReviewCases,
  financeTransactions,
  users,
} from "@personal-os/database";
import {
  type FinanceContextualQuestion,
  type FinanceHumanWorkRef,
  financeContextualQuestionSchema,
  financeProvenanceSchema,
  idSchema,
} from "@personal-os/domain";
import { and, eq } from "drizzle-orm";
import { AppError } from "../errors.js";
import type { Principal } from "../types.js";
import type { FinanceTransaction } from "./context.js";

export type ContextualPrincipal = { principal: Principal; requestId: string };
export type ContextualOptions = { db: Database; now?: () => Date };
export type QuestionRow = typeof financeContextualQuestions.$inferSelect;
export const contextualSubtype = "manual_transaction_purpose_v1";
export const maxContextualRevision = 9223372036854775807n;

export function authorizeContextual(
  context: ContextualPrincipal,
  scope: "finances:read" | "finances:write",
) {
  const { principal } = context;
  if (!principal.scopes.has(scope) || !["user", "agent"].includes(principal.actorType))
    throw new AppError(
      "forbidden",
      `Contextual questions require ${scope} and a user or agent principal.`,
    );
  idSchema.parse(principal.userId);
  financeProvenanceSchema.shape.actorId.unwrap().parse(principal.actorId);
  financeProvenanceSchema.shape.requestId.unwrap().parse(context.requestId);
}
export async function admitContextualOwner(tx: FinanceTransaction, userId: string) {
  const [owner] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .for("key share");
  if (!owner) throw new AppError("not_found", "Account not found.");
}
export function contextualRetry(): AppError {
  return new AppError(
    "conflict",
    "The transaction changed or is busy. Retry with the same operation ID.",
    { retryable: true },
  );
}
/** Supplied callers must propagate errors and roll back the entire transaction. */
export async function contextualTransaction<T>(
  db: Database,
  executor: FinanceTransaction | undefined,
  run: (tx: FinanceTransaction) => Promise<T>,
): Promise<T> {
  try {
    return await (executor ? run(executor) : db.transaction(run));
  } catch (error) {
    let cause: unknown = error;
    const seen = new Set<unknown>();
    while (typeof cause === "object" && cause !== null && !seen.has(cause)) {
      seen.add(cause);
      if ("code" in cause && (cause.code === "55P03" || cause.code === "40001"))
        throw contextualRetry();
      cause = "cause" in cause ? cause.cause : null;
    }
    throw error;
  }
}
export async function lockContextualTransaction(
  tx: FinanceTransaction,
  userId: string,
  transactionId: string,
  write = false,
) {
  const [preview] = await tx
    .select({ accountId: financeTransactions.accountId })
    .from(financeTransactions)
    .where(and(eq(financeTransactions.userId, userId), eq(financeTransactions.id, transactionId)));
  if (!preview) return null;
  const [account] = await tx
    .select()
    .from(financeAccounts)
    .where(and(eq(financeAccounts.userId, userId), eq(financeAccounts.id, preview.accountId)))
    .for("share", { noWait: true });
  const [transaction] = await tx
    .select()
    .from(financeTransactions)
    .where(and(eq(financeTransactions.userId, userId), eq(financeTransactions.id, transactionId)))
    .for(write ? "update" : "share", { noWait: true });
  if (!account || !transaction) throw contextualRetry();
  if (transaction.accountId !== account.id) throw contextualRetry();
  return { account, transaction };
}
export function eligibleContextualTransaction(
  parent: NonNullable<Awaited<ReturnType<typeof lockContextualTransaction>>>,
) {
  const { account, transaction } = parent;
  return (
    account.provider === "manual" &&
    account.status === "manual" &&
    account.providerItemId === null &&
    account.providerItemRecordId === null &&
    account.providerAccountId === null &&
    !transaction.pending &&
    transaction.needsReview &&
    transaction.category === null &&
    transaction.categoryId === null &&
    transaction.providerTransactionId === null &&
    transaction.pendingTransactionId === null &&
    (transaction.direction === "expense" || transaction.direction === "income") &&
    transaction.reconciliationStatus === "not_applicable" &&
    transaction.transferGroupId === null
  );
}
/** One question only. Never compose repeated calls behind an existing domain/outbox lock set. */
export async function lockContextualQuestion(
  tx: FinanceTransaction,
  userId: string,
  id: string,
  write: boolean,
  heldParent?: NonNullable<Awaited<ReturnType<typeof lockContextualTransaction>>>,
) {
  const [preview] = await tx
    .select()
    .from(financeContextualQuestions)
    .where(
      and(eq(financeContextualQuestions.userId, userId), eq(financeContextualQuestions.id, id)),
    );
  if (!preview || preview.subtype !== contextualSubtype) return null;
  if (heldParent && heldParent.transaction.id !== preview.transactionId) throw contextualRetry();
  const parent = heldParent ?? (await lockContextualTransaction(tx, userId, preview.transactionId));
  if (!parent) throw contextualRetry();
  const [review] = await tx
    .select()
    .from(financeReviewCases)
    .where(
      and(eq(financeReviewCases.userId, userId), eq(financeReviewCases.id, preview.reviewCaseId)),
    )
    .for("share", { noWait: true });
  const [question] = await tx
    .select()
    .from(financeContextualQuestions)
    .where(
      and(eq(financeContextualQuestions.userId, userId), eq(financeContextualQuestions.id, id)),
    )
    .for(write ? "update" : "share", { noWait: true });
  if (!review || !question) throw contextualRetry();
  if (
    question.transactionId !== parent.transaction.id ||
    question.accountId !== parent.account.id ||
    question.reviewCaseId !== review.id ||
    review.transactionId !== parent.transaction.id
  )
    throw contextualRetry();
  return { ...parent, review, question };
}
export type LockedContextualQuestion = NonNullable<
  Awaited<ReturnType<typeof lockContextualQuestion>>
>;
export function currentContextualParents(locked: LockedContextualQuestion) {
  const { question, account, transaction, review } = locked;
  return (
    eligibleContextualTransaction(locked) &&
    question.dependencyAdapterVersion === 1 &&
    question.accountRevision === account.contextualRevision &&
    question.transactionRevision === transaction.contextualRevision &&
    question.reviewRevision === review.contextualRevision &&
    review.status === "open" &&
    review.economicEventId === null &&
    review.suggestedCategoryId === null &&
    review.reopenedFromId === null &&
    review.proposedResolution === null &&
    review.resolution === null &&
    Object.keys(review.evidence).length === 0
  );
}
export function contextualWork(question: QuestionRow): FinanceHumanWorkRef {
  return {
    id: question.id,
    domain: "finances",
    kind: "question",
    revision: question.workRevision.toString(),
    actionRevision: question.actionRevision.toString(),
  };
}
export function contextualValue(locked: LockedContextualQuestion): FinanceContextualQuestion {
  const { question } = locked;
  return financeContextualQuestionSchema.parse({
    id: question.id,
    reviewCaseId: question.reviewCaseId,
    transactionId: question.transactionId,
    prompt: question.prompt,
    disclosure: question.disclosure,
    work: contextualWork(question),
    status:
      question.state === "answered"
        ? "answered"
        : question.state === "open" && currentContextualParents(locked)
          ? "open"
          : "stale",
    transaction: {
      merchant: question.merchant,
      date: question.transactionDate,
      amountCents: question.amount,
      currencyCode: question.currencyCode,
    },
  });
}
export async function exactContextualAnswer(
  tx: FinanceTransaction,
  userId: string,
  question: QuestionRow,
  work: FinanceHumanWorkRef,
) {
  if (question.state !== "answered") return false;
  const answers = await tx
    .select({
      workRevision: financeContextualAnswers.answeredWorkRevision,
      actionRevision: financeContextualAnswers.answeredActionRevision,
    })
    .from(financeContextualAnswers)
    .where(
      and(
        eq(financeContextualAnswers.userId, userId),
        eq(financeContextualAnswers.questionId, question.id),
      ),
    );
  return answers.some(
    (answer) =>
      answer.workRevision.toString() === work.revision &&
      answer.actionRevision.toString() === work.actionRevision,
  );
}
