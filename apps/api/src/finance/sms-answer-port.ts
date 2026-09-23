import {
  type FinanceDomainOutcome,
  type FinanceHumanWorkRef,
  type FinanceSmsAnswerCommand,
  financeDomainOutcomeSchema,
  financeSmsAnswerCommandSchema,
} from "@personal-os/domain";
import { AppError } from "../errors.js";
import { answerSmsContextualWork } from "./answer-service.js";
import {
  type FinanceTransaction,
  loadFinanceAuthorization,
  readFinanceAdmittedReceipt,
} from "./context.js";
import type { ContextualPrincipal } from "./contextual-question-store.js";
import {
  authorizeContextual,
  type ContextualOptions,
  contextualTransaction,
} from "./contextual-question-store.js";
import { type FinanceSmsQuestionResolution, resolveSmsQuestion } from "./work-resolver.js";

/**
 * Server composition injects this Texting-owned verifier with an explicit enabled policy.
 * After Finance owner/operation admission, lock connection, inbound message, outbound message,
 * then binding. Waiting/uncertain failures throw; they must not become terminal unavailable.
 * Explicit disablement or a failed policy check throws for rollback and bounded recovery;
 * neither creates a terminal receipt. Completed replay skips this verifier entirely.
 */
export type AdmitSmsAnswer = (
  tx: FinanceTransaction,
  expected: FinanceSmsAnswerCommand & { userId: string },
) => Promise<
  | { state: "unavailable" }
  | {
      state: "verified";
      /**
       * One-shot accepted CAS under held binding lock; recheck enabled policy here.
       * Disabled policy or CAS failure throws, rolling back the entire caller transaction.
       */
      consume: (accepted: FinanceDomainOutcome & { state: "accepted" }) => Promise<void>;
    }
>;

export type FinanceSmsReceiptInspection =
  | { state: "absent" }
  | { state: "completed"; outcome: FinanceDomainOutcome }
  | { state: "incomplete"; status: "started" | "failed" };

/** Internal composition contract; public app/agent routes cannot inject admission. */
export interface FinanceSmsPort {
  /** Finance owns this read transaction; callers must hold no Texting locks. */
  inspectSmsReceipt(
    userId: string,
    command: FinanceSmsAnswerCommand,
  ): Promise<FinanceSmsReceiptInspection>;
  resolveSmsQuestion(
    userId: string,
    work: FinanceHumanWorkRef,
    tx: FinanceTransaction,
  ): Promise<FinanceSmsQuestionResolution>;
  answerSmsWork(
    command: FinanceSmsAnswerCommand,
    context: ContextualPrincipal,
    tx: FinanceTransaction,
  ): Promise<FinanceDomainOutcome>;
}

export function createFinanceSmsPort(
  options: ContextualOptions & { admitSmsAnswer: AdmitSmsAnswer },
): FinanceSmsPort {
  return {
    resolveSmsQuestion,
    async inspectSmsReceipt(userId, raw) {
      const command = financeSmsAnswerCommandSchema.parse(raw);
      const context: ContextualPrincipal = {
        principal: {
          actorType: "user",
          actorId: userId,
          userId,
          scopes: new Set(["finances:write"]),
        },
        requestId: "finance-sms-receipt-inspection",
      };
      authorizeContextual(context, "finances:write");
      return contextualTransaction(options.db, undefined, async (tx) => {
        const authority = await loadFinanceAuthorization({ db: tx, ...context });
        const receipt = await readFinanceAdmittedReceipt(tx, authority, {
          idempotencyKey: command.operationId,
          operation: "answer_contextual_question_v1",
          sourceKind: "sms",
          payload: command,
        });
        if (!receipt) return { state: "absent" };
        if (receipt.status !== "completed") return { state: "incomplete", status: receipt.status };
        const parsed = financeDomainOutcomeSchema.safeParse(receipt.response);
        if (
          !parsed.success ||
          parsed.data.operationId !== command.operationId ||
          !["accepted", "blocked"].includes(parsed.data.state) ||
          parsed.data.work.length !== 0 ||
          (parsed.data.state === "accepted" &&
            (parsed.data.reasonCode !== null ||
              !/^[1-9][0-9]*$/.test(command.work.revision) ||
              parsed.data.resultRevision !== (BigInt(command.work.revision) + 1n).toString())) ||
          (parsed.data.state === "blocked" &&
            (parsed.data.reasonCode !== "stale_revision" || parsed.data.resultRevision !== null))
        )
          throw new AppError("internal_error", "Finance SMS receipt cannot be reconciled.");
        return { state: "completed", outcome: parsed.data };
      });
    },
    async answerSmsWork(raw, context, tx) {
      authorizeContextual(context, "finances:write");
      if (
        context.principal.actorType !== "user" ||
        context.principal.actorId !== context.principal.userId
      )
        throw new AppError("forbidden", "SMS answers require the bound user's authority.");
      const command = financeSmsAnswerCommandSchema.parse(raw);
      return answerSmsContextualWork(options, command, context, tx, options.admitSmsAnswer);
    },
  };
}
