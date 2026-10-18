import { createHash } from "node:crypto";
import {
  deriveFinanceOnboardingReadiness,
  type FinanceOnboardingSaveInput,
  type FinanceOnboardingSnapshot,
  financeOnboardingCompleteInputSchema,
  financeOnboardingSaveInputSchema,
} from "@personal-os/domain";
import { AppError } from "./errors.js";
import { type FinanceMutationContext, requireFinanceMutation } from "./finance/context.js";

export interface FinanceOnboardingState {
  revision: number;
  completedAt: string | null;
  answers: FinanceOnboardingSaveInput["answers"];
  displayPreferencesReviewed: boolean;
  automationChoice: "later" | "now" | null;
  updatedAt: string | null;
}
export type FinanceOnboardingEvidence = Pick<
  FinanceOnboardingSnapshot,
  "existingAccess" | "source" | "contextReview" | "questions" | "manualVisibility" | "automation"
> & { displayPreferences: { summary: string[] } };
export type FinanceOnboardingRead = {
  state: FinanceOnboardingState;
  evidence: FinanceOnboardingEvidence;
};
export interface FinanceOnboardingReceipt {
  operation: "save" | "complete";
  requestHash: string;
  result: FinanceOnboardingSnapshot;
}
/** All methods are bound to the admitted owner and the same database transaction. */
export interface FinanceOnboardingTransaction {
  read(): Promise<FinanceOnboardingRead>;
  readReceipt(idempotencyKey: string): Promise<FinanceOnboardingReceipt | null>;
  /** Atomically CAS state, append audit, and store the exact replay receipt; rollback on any failure. */
  write(input: {
    expectedRevision: number;
    state: FinanceOnboardingState;
    receipt: FinanceOnboardingReceipt & { idempotencyKey: string };
    context: FinanceMutationContext;
  }): Promise<void>;
}
export interface FinanceOnboardingRepository {
  /** Read-only; absent rows resolve to revision zero without inserting. */
  read(userId: string): Promise<FinanceOnboardingRead>;
  /** Admit owner, recheck execution authority, lock profile/onboarding, then run callback atomically. */
  withOwnerTransaction<T>(
    context: FinanceMutationContext,
    action: (transaction: FinanceOnboardingTransaction) => Promise<T>,
  ): Promise<T>;
}

function snapshot({ state, evidence }: FinanceOnboardingRead): FinanceOnboardingSnapshot {
  const reviews = new Map(state.answers.map((answer) => [answer.questionId, answer.disposition]));
  const questions = evidence.questions.map((question) => {
    const disposition = reviews.get(question.questionId) ?? question.disposition;
    return {
      ...question,
      disposition:
        disposition === "answered" &&
        (question.disposition !== "answered" || !question.answerSummary?.trim())
          ? ("unreviewed" as const)
          : disposition,
    };
  });
  return {
    ...evidence,
    revision: state.revision,
    completedAt: state.completedAt,
    questions,
    displayPreferences: {
      summary: evidence.displayPreferences.summary,
      reviewed: state.displayPreferencesReviewed,
    },
    automationChoice: state.automationChoice,
  };
}

/** Review receipts only: no profile mutation, provider calls, budget activation, or fallback storage. */
export function createFinanceOnboardingService(options: {
  repository: FinanceOnboardingRepository;
  now?: () => Date;
}) {
  const now = options.now ?? (() => new Date());
  async function mutate(
    operation: "save" | "complete",
    value: unknown,
    context: FinanceMutationContext,
  ): Promise<FinanceOnboardingSnapshot> {
    requireFinanceMutation(context);
    const input =
      operation === "save"
        ? financeOnboardingSaveInputSchema.parse(value)
        : financeOnboardingCompleteInputSchema.parse(value);
    const requestHash = createHash("sha256")
      .update(
        JSON.stringify({
          operation,
          input,
          actorId: context.actorId,
          actorType: context.actorType,
        }),
      )
      .digest("hex");
    return options.repository.withOwnerTransaction(context, async (tx) => {
      const receipt = await tx.readReceipt(input.idempotencyKey);
      if (receipt) {
        if (receipt.operation !== operation || receipt.requestHash !== requestHash)
          throw new AppError("conflict", "This idempotency key was used for different setup work.");
        return receipt.result;
      }
      const current = await tx.read();
      if (current.state.revision !== input.expectedRevision)
        throw new AppError("conflict", "Finance setup changed. Reload before continuing.");
      const state: FinanceOnboardingState = {
        ...current.state,
        answers: current.state.answers.map((answer) => ({ ...answer })),
        automationChoice: input.automationChoice,
        revision: current.state.revision + 1,
        updatedAt: now().toISOString(),
      };
      if (operation === "save") {
        const saved = financeOnboardingSaveInputSchema.parse(input);
        const canonical = new Map(
          current.evidence.questions.map((question) => [question.questionId, question]),
        );
        const answers = new Map(state.answers.map((answer) => [answer.questionId, answer]));
        for (const answer of saved.answers) {
          const question = canonical.get(answer.questionId);
          if (!question)
            throw new AppError(
              "invalid_request",
              "That question does not belong to Finance setup.",
            );
          if (answer.disposition === "none" && !question.allowsNone)
            throw new AppError("invalid_request", "This question does not allow a none answer.");
          if (
            answer.disposition === "answered" &&
            (question.disposition !== "answered" || !question.answerSummary?.trim())
          )
            throw new AppError("conflict", "Save the financial answer before marking it reviewed.");
          answers.set(answer.questionId, answer);
        }
        state.answers = [...answers.values()];
        if (state.completedAt !== null && !saved.displayPreferencesReviewed)
          throw new AppError("conflict", "Completed Finance setup must retain its display review.");
        state.displayPreferencesReviewed = saved.displayPreferencesReviewed;
      } else if (state.completedAt === null) {
        const readiness = deriveFinanceOnboardingReadiness(
          snapshot({ state, evidence: current.evidence }),
        );
        if (!readiness.canComplete)
          throw new AppError(
            "conflict",
            "Review the required Finance setup information before finishing.",
            {
              blockers: readiness.blockers,
            },
          );
        state.completedAt = state.updatedAt;
      }
      const result = snapshot({ state, evidence: current.evidence });
      await tx.write({
        expectedRevision: input.expectedRevision,
        state,
        receipt: { idempotencyKey: input.idempotencyKey, operation, requestHash, result },
        context,
      });
      return result;
    });
  }
  return {
    async getFinanceOnboarding(userId: string) {
      return snapshot(await options.repository.read(userId));
    },
    saveFinanceOnboardingAnswers: (value: unknown, context: FinanceMutationContext) =>
      mutate("save", value, context),
    completeFinanceOnboarding: (value: unknown, context: FinanceMutationContext) =>
      mutate("complete", value, context),
  };
}
